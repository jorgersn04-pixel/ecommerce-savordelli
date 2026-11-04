'use strict';

const { pool, withTransaction } = require('../config/db');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');
const { decifrar } = require('../utils/crypto');
const gateway = require('../integrations/mercadopago/client');
const pedidos = require('../repositories/pedidos.repository');
const estoque = require('./estoque.service');
const outbox = require('./bling-outbox.service');

const PROVEDOR = 'mercadopago';
const MAX_TENTATIVAS = 5;
const EXPIRA_PIX_MIN = 30;
const EXPIRA_BOLETO_DIAS = 3;

function dadosDoPagador(pedido) {
  const c = pedido.snapshot_cliente;
  const partes = String(c.nome).trim().split(/\s+/);
  const cpf = c.cpf_cifrado ? decifrar(Buffer.from(c.cpf_cifrado, 'base64')) : null;
  return {
    email: c.email,
    nome: partes[0],
    sobrenome: partes.slice(1).join(' ') || partes[0],
    cpf,
    endereco: pedido.snapshot_endereco,
  };
}

function expiracao(metodo) {
  if (metodo === 'pix') return new Date(Date.now() + EXPIRA_PIX_MIN * 60_000);
  if (metodo === 'boleto') return new Date(Date.now() + EXPIRA_BOLETO_DIAS * 86_400_000);
  return undefined;
}

/**
 * Aplica um status de pagamento de forma idempotente e serializada (lock no pagamento e no pedido).
 * Chamado pelo retorno do gateway, pelo webhook e pela reconciliacao.
 */
async function aplicarStatus(pagamentoId, novoStatus, { pagoEm = null, autor = 'gateway' } = {}) {
  return withTransaction(async (conn) => {
    const [[pg]] = await conn.execute('SELECT * FROM pagamentos WHERE id = ? FOR UPDATE', [pagamentoId]);
    if (!pg) throw new AppError(404, 'PAGAMENTO_NAO_ENCONTRADO', 'Pagamento nao encontrado');
    if (pg.status === novoStatus) return { mudou: false };
    // Estados finais nao regridem: aprovado so evolui para estornado; estornado e terminal.
    if (pg.status === 'estornado') return { mudou: false };
    if (pg.status === 'aprovado' && novoStatus !== 'estornado') return { mudou: false };

    const pedido = await pedidos.buscarPorId(conn, pg.pedido_id, true);
    await conn.execute('UPDATE pagamentos SET status = ?, pago_em = COALESCE(?, pago_em) WHERE id = ?', [
      novoStatus, novoStatus === 'aprovado' ? (pagoEm ?? new Date()) : null, pagamentoId,
    ]);

    if (novoStatus === 'aprovado') {
      if (pedido.status === 'aguardando_pagamento') {
        await conn.execute("UPDATE pedidos SET status = 'pago' WHERE id = ?", [pedido.id]);
        await estoque.baixarReserva(conn, pedido.id);
        await pedidos.registrarHistorico(conn, pedido.id, pedido.status, 'pago', autor, `Pagamento ${pg.metodo} aprovado`);
        await outbox.enfileirar(conn, 'pedido', pedido.id, 'criar', { numero: pedido.numero });
      } else {
        // Pedido cancelado/ja pago: o dinheiro entrou e precisa ser devolvido manualmente.
        await pedidos.registrarHistorico(
          conn, pedido.id, pedido.status, pedido.status, autor,
          `ATENCAO: pagamento ${pg.id} aprovado com o pedido em "${pedido.status}". Estorno manual necessario`,
        );
        logger.error({ pedido: pedido.numero, pagamento: pg.id }, 'pagamento aprovado fora do fluxo: estorno manual');
      }
    } else if (novoStatus === 'estornado') {
      if (['pago', 'em_separacao', 'enviado', 'entregue', 'cancelado'].includes(pedido.status)) {
        await conn.execute("UPDATE pedidos SET status = 'reembolsado' WHERE id = ?", [pedido.id]);
        await pedidos.registrarHistorico(conn, pedido.id, pedido.status, 'reembolsado', autor, 'Pagamento estornado');
        await outbox.enfileirar(conn, 'pedido', pedido.id, 'atualizar', { numero: pedido.numero });
      }
    }
    return { mudou: true };
  });
}

/** Cria a tentativa de pagamento do pedido e processa no gateway. */
async function pagar(pedido, dados) {
  if (pedido.status !== 'aguardando_pagamento') {
    throw new AppError(409, 'PEDIDO_NAO_PAGAVEL', 'Este pedido nao esta aguardando pagamento');
  }
  const parcelas = dados.metodo === 'cartao_credito' ? dados.parcelas : 1;

  const { pagamentoId, aCancelar } = await withTransaction(async (conn) => {
    const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM pagamentos WHERE pedido_id = ? FOR UPDATE', [pedido.id]);
    if (Number(n) >= MAX_TENTATIVAS) {
      throw new AppError(422, 'LIMITE_TENTATIVAS', 'Limite de tentativas de pagamento atingido para este pedido');
    }
    // Uma unica tentativa pendente por vez: as anteriores sao encerradas.
    const [pendentes] = await conn.execute(
      "SELECT id, provedor_transacao_id FROM pagamentos WHERE pedido_id = ? AND status = 'pendente'", [pedido.id],
    );
    for (const p of pendentes) await conn.execute("UPDATE pagamentos SET status = 'expirado' WHERE id = ?", [p.id]);
    const [r] = await conn.execute(
      'INSERT INTO pagamentos (pedido_id, metodo, provedor, valor, parcelas) VALUES (?, ?, ?, ?, ?)',
      [pedido.id, dados.metodo, PROVEDOR, pedido.total, parcelas],
    );
    return { pagamentoId: String(r.insertId), aCancelar: pendentes.map((p) => p.provedor_transacao_id).filter(Boolean) };
  });
  for (const t of aCancelar) gateway.cancelarPagamento(t);

  let resultado;
  try {
    resultado = await gateway.criarPagamento({
      valor: pedido.total,
      descricao: `Pedido ${pedido.numero} - Savordelli`,
      metodo: dados.metodo,
      parcelas,
      token: dados.token,
      paymentMethodId: dados.payment_method_id,
      issuerId: dados.issuer_id,
      referencia: pedido.numero,
      chaveIdempotencia: `savordelli-pag-${pagamentoId}`,
      expiraEm: expiracao(dados.metodo),
      payer: dadosDoPagador(pedido),
    });
  } catch (err) {
    await pool.execute("UPDATE pagamentos SET status = 'recusado' WHERE id = ? AND status = 'pendente'", [pagamentoId]);
    throw err;
  }

  await pool.execute('UPDATE pagamentos SET provedor_transacao_id = ? WHERE id = ?', [resultado.transacaoId, pagamentoId]);
  await aplicarStatus(pagamentoId, resultado.status, { pagoEm: resultado.pagoEm });

  const [[pg]] = await pool.execute('SELECT status FROM pagamentos WHERE id = ?', [pagamentoId]);
  return {
    id: pagamentoId,
    metodo: dados.metodo,
    status: pg.status,
    parcelas,
    mensagem: pg.status === 'recusado' ? 'Pagamento recusado. Tente outro cartao ou outra forma de pagamento' : null,
    pix: resultado.pix,
    boleto: resultado.boleto,
    expira_em: resultado.expiraEm,
  };
}

/**
 * Reconcilia um pagamento a partir do id do gateway (webhook ou polling).
 * Retorna { encontrado }. Lanca 503 quando o webhook chega antes de gravarmos o id (o gateway reenvia).
 */
async function reconciliarPorTransacao(transacaoId) {
  const info = await gateway.buscarPagamento(transacaoId);
  if (!info) return { encontrado: false };

  const [[pg]] = await pool.execute(
    'SELECT id FROM pagamentos WHERE provedor = ? AND provedor_transacao_id = ?', [PROVEDOR, info.transacaoId],
  );
  if (!pg) {
    const [[corrida]] = await pool.execute(
      `SELECT 1 AS x FROM pagamentos g JOIN pedidos p ON p.id = g.pedido_id
        WHERE p.numero = ? AND g.provedor_transacao_id IS NULL AND g.criado_em > UTC_TIMESTAMP() - INTERVAL 5 MINUTE LIMIT 1`,
      [info.referenciaExterna ?? ''],
    );
    if (corrida) throw new AppError(503, 'AGUARDANDO_REGISTRO', 'Pagamento ainda em registro; tente novamente');
    logger.warn({ transacaoId }, 'webhook de pagamento desconhecido');
    return { encontrado: false };
  }
  await aplicarStatus(pg.id, info.status, { pagoEm: info.pagoEm, autor: 'gateway' });
  return { encontrado: true, status: info.status };
}

/** Situacao atual do pagamento do pedido (reconcilia com o gateway se ainda pendente). */
async function situacaoAtual(pedido) {
  const lista = await pedidos.pagamentos(pool, pedido.id);
  const ultimo = lista[lista.length - 1];
  if (!ultimo) return null;
  let pix = null;
  let boleto = null;
  let expiraEm = null;
  if (ultimo.status === 'pendente' && ultimo.provedor_transacao_id) {
    const info = await gateway.buscarPagamento(ultimo.provedor_transacao_id);
    if (info) {
      await aplicarStatus(ultimo.id, info.status, { pagoEm: info.pagoEm });
      ({ pix, boleto } = info);
      expiraEm = info.expiraEm;
    }
  }
  const [[atual]] = await pool.execute('SELECT status FROM pagamentos WHERE id = ?', [ultimo.id]);
  return { metodo: ultimo.metodo, status: atual.status, parcelas: ultimo.parcelas, pix, boleto, expira_em: expiraEm };
}

module.exports = { pagar, aplicarStatus, reconciliarPorTransacao, situacaoAtual };
