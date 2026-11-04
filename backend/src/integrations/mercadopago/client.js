'use strict';

const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../config/logger');
const AppError = require('../../utils/AppError');
const { requisitar } = require('../http');

const BASE = 'https://api.mercadopago.com';
const simulado = !env.MERCADOPAGO_ACCESS_TOKEN;

// Estado do gateway simulado (apenas dev/test, sem credenciais).
const mock = new Map();

function exigirConfiguracao() {
  if (simulado && env.isProd) throw new AppError(503, 'PAGAMENTO_INDISPONIVEL', 'Pagamentos não configurados');
}

/** Status do Mercado Pago -> status interno da tabela pagamentos. */
function mapearStatus(status, detalhe) {
  switch (status) {
    case 'approved':
      return 'aprovado';
    case 'pending':
    case 'in_process':
    case 'authorized':
    case 'in_mediation':
      return 'pendente';
    case 'refunded':
    case 'charged_back':
      return 'estornado';
    case 'cancelled':
      return detalhe === 'expired' ? 'expirado' : 'recusado';
    default:
      return 'recusado'; // rejected e desconhecidos
  }
}

function normalizar(j) {
  const td = j.point_of_interaction?.transaction_data;
  return {
    transacaoId: String(j.id),
    status: mapearStatus(j.status, j.status_detail),
    statusGateway: j.status,
    detalhe: j.status_detail ?? null,
    referenciaExterna: j.external_reference ?? null,
    pagoEm: j.date_approved ? new Date(j.date_approved) : null,
    expiraEm: j.date_of_expiration ?? null,
    pix: td?.qr_code ? { qr_code: td.qr_code, qr_code_base64: td.qr_code_base64 ?? null } : null,
    boleto: j.transaction_details?.external_resource_url
      ? { url: j.transaction_details.external_resource_url, codigo_barras: j.barcode?.content ?? null }
      : null,
  };
}

const headers = (extra = {}) => ({ Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`, ...extra });

function erroHttp(r) {
  if (r.status === 400 || r.status === 422) {
    logger.warn({ status: r.status, causa: r.json?.cause?.map((c) => c.code) }, 'Mercado Pago recusou a requisicao');
    return new AppError(422, 'PAGAMENTO_INVALIDO', 'Não foi possível processar o pagamento. Verifique os dados informados');
  }
  if (r.status === 401 || r.status === 403) {
    logger.error({ status: r.status }, 'Mercado Pago: credencial rejeitada');
  }
  return new AppError(502, 'PAGAMENTO_INDISPONIVEL', 'Pagamento indisponível no momento. Tente novamente');
}

/**
 * Cria um pagamento (POST /v1/payments).
 * d: { valor:'123.45', descricao, metodo, parcelas, token, paymentMethodId, issuerId, referencia,
 *      chaveIdempotencia, expiraEm:Date, payer:{ email, nome, sobrenome, cpf, endereco? } }
 */
async function criarPagamento(d) {
  exigirConfiguracao();
  if (simulado) {
    logger.warn('Mercado Pago sem token: usando gateway SIMULADO');
    const id = `MOCK-${crypto.randomBytes(5).toString('hex')}`;
    const aprovado = d.metodo === 'cartao_credito' && d.token !== 'tok_recusado';
    const gw = aprovado ? 'approved' : d.metodo === 'cartao_credito' ? 'rejected' : 'pending';
    mock.set(id, { status: gw, detalhe: gw === 'rejected' ? 'cc_rejected_other_reason' : null, referencia: d.referencia });
    return normalizar({
      id, status: gw, status_detail: mock.get(id).detalhe, external_reference: d.referencia,
      date_approved: aprovado ? new Date().toISOString() : null,
      date_of_expiration: d.expiraEm?.toISOString(),
      point_of_interaction: d.metodo === 'pix' ? { transaction_data: { qr_code: `00020126MOCK${id}`, qr_code_base64: 'bW9jaw==' } } : undefined,
      transaction_details: d.metodo === 'boleto' ? { external_resource_url: `https://mock.local/boleto/${id}` } : undefined,
      barcode: d.metodo === 'boleto' ? { content: '23790000090000000000000000000000000000000000' } : undefined,
    });
  }

  const payer = {
    email: d.payer.email,
    first_name: d.payer.nome,
    last_name: d.payer.sobrenome,
    identification: { type: 'CPF', number: d.payer.cpf },
  };
  if (d.metodo === 'boleto' && d.payer.endereco) {
    const e = d.payer.endereco;
    payer.address = {
      zip_code: e.cep, street_name: e.logradouro, street_number: String(e.numero),
      neighborhood: e.bairro, city: e.cidade, federal_unit: e.uf,
    };
  }
  const corpo = {
    transaction_amount: Number(d.valor),
    description: d.descricao,
    external_reference: d.referencia,
    payment_method_id: d.metodo === 'pix' ? 'pix' : d.metodo === 'boleto' ? 'bolbradesco' : d.paymentMethodId,
    payer,
  };
  if (d.metodo === 'cartao_credito') {
    corpo.token = d.token;
    corpo.installments = d.parcelas;
    if (d.issuerId) corpo.issuer_id = Number(d.issuerId);
  }
  if (d.expiraEm && d.metodo !== 'cartao_credito') {
    corpo.date_of_expiration = d.expiraEm.toISOString().replace('Z', '+00:00');
  }
  if (env.API_PUBLIC_URL) corpo.notification_url = `${env.API_PUBLIC_URL}/webhooks/mercadopago`;

  const r = await requisitar('mercadopago', `${BASE}/v1/payments`, {
    metodo: 'POST',
    headers: headers({ 'X-Idempotency-Key': d.chaveIdempotencia }),
    corpo,
    timeoutMs: 20_000,
  });
  if (!r.ok || !r.json?.id) throw erroHttp(r);
  return normalizar(r.json);
}

/** Consulta o pagamento no gateway (fonte da verdade; nunca confiar no corpo do webhook). */
async function buscarPagamento(transacaoId) {
  exigirConfiguracao();
  if (simulado) {
    const m = mock.get(String(transacaoId));
    if (!m) return null;
    return normalizar({ id: transacaoId, status: m.status, status_detail: m.detalhe, external_reference: m.referencia });
  }
  const r = await requisitar('mercadopago', `${BASE}/v1/payments/${encodeURIComponent(transacaoId)}`, { headers: headers() });
  if (r.status === 404) return null;
  if (!r.ok || !r.json?.id) throw erroHttp(r);
  return normalizar(r.json);
}

/** Cancela pagamento pendente (pix/boleto). Melhor esforco: falhas sao apenas registradas. */
async function cancelarPagamento(transacaoId) {
  try {
    if (simulado) {
      const m = mock.get(String(transacaoId));
      if (m && m.status === 'pending') m.status = 'cancelled';
      return;
    }
    await requisitar('mercadopago', `${BASE}/v1/payments/${encodeURIComponent(transacaoId)}`, {
      metodo: 'PUT', headers: headers(), corpo: { status: 'cancelled' },
    });
  } catch (err) {
    logger.warn({ err: err.message, transacaoId }, 'nao foi possivel cancelar pagamento no gateway');
  }
}

/**
 * Valida o header x-signature do webhook:
 *   manifest = `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`  -> HMAC-SHA256(secret) == v1
 */
function verificarAssinatura({ assinatura, requestId, dataId, secret = env.MERCADOPAGO_WEBHOOK_SECRET }) {
  if (!secret || !assinatura) return false;
  const partes = Object.fromEntries(
    String(assinatura).split(',').map((p) => p.trim().split('=').map((s) => s.trim())),
  );
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId);
  const manifesto = `id:${id};request-id:${requestId ?? ''};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', secret).update(manifesto).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(partes.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Apenas dev/test: altera o status no gateway simulado (ex.: 'approved'). */
function definirStatusSimulado(transacaoId, status) {
  if (!simulado) throw new Error('disponivel apenas no gateway simulado');
  const m = mock.get(String(transacaoId));
  if (!m) throw new Error('transacao simulada inexistente');
  m.status = status;
}

module.exports = {
  criarPagamento, buscarPagamento, cancelarPagamento, verificarAssinatura, definirStatusSimulado, simulado, mapearStatus,
};
