'use strict';

const env = require('../config/env');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');
const gateway = require('../integrations/mercadopago/client');
const pagamentos = require('../services/pagamento.service');

/**
 * Webhook do Mercado Pago. O corpo nunca e confiado: so o id do pagamento e usado, e o estado real
 * e consultado na API do gateway. Responde 200 para eventos ignorados/desconhecidos (evita reenvio infinito).
 */
async function mercadopago(req, res) {
  const tipo = req.query.type || req.query.topic || req.body?.type;
  const dataId = req.query['data.id'] || req.body?.data?.id;

  if (env.MERCADOPAGO_WEBHOOK_SECRET) {
    const ok = gateway.verificarAssinatura({
      assinatura: req.get('x-signature'),
      requestId: req.get('x-request-id'),
      dataId,
    });
    if (!ok) throw new AppError(401, 'ASSINATURA_INVALIDA', 'Assinatura invalida');
  } else if (env.isProd) {
    throw new AppError(503, 'WEBHOOK_NAO_CONFIGURADO', 'Webhook sem segredo configurado');
  } else {
    logger.warn('Webhook Mercado Pago aceito SEM verificar assinatura (MERCADOPAGO_WEBHOOK_SECRET ausente)');
  }

  if (tipo && !String(tipo).includes('payment')) return res.sendStatus(200);
  if (!dataId) return res.sendStatus(200);

  await pagamentos.reconciliarPorTransacao(String(dataId));
  return res.sendStatus(200);
}

/**
 * Webhook do Bling. Valida X-Bling-Signature-256 sobre o corpo bruto, grava o evento de forma
 * idempotente (eventId) e processa. Falha de processamento NAO gera erro HTTP: o evento fica
 * salvo e o worker o reprocessa (evita tempestade de reenvios).
 */
async function blingEvento(req, res) {
  const bling = require('../integrations/bling');
  const webhook = require('../services/bling-webhook.service');

  if (bling.configurado) {
    if (!webhook.assinaturaValida(req.rawBody, req.get('x-bling-signature-256'))) {
      throw new AppError(401, 'ASSINATURA_INVALIDA', 'Assinatura invalida');
    }
  } else if (env.isProd) {
    throw new AppError(503, 'WEBHOOK_NAO_CONFIGURADO', 'Bling nao configurado');
  } else {
    logger.warn('Webhook Bling aceito SEM verificar assinatura (Bling simulado)');
  }

  if (!req.body || typeof req.body !== 'object') throw new AppError(400, 'JSON_INVALIDO', 'Corpo invalido');
  const { id, novo } = await webhook.registrar(req.body, req.rawBody);
  if (novo) {
    try {
      await webhook.processarEvento(id);
    } catch (err) {
      logger.warn({ evento: id, erro: err.message }, 'bling webhook: processamento adiado para o worker');
    }
  }
  res.sendStatus(200);
}

module.exports = { mercadopago, blingEvento };
