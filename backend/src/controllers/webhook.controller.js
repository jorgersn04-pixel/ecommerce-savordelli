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

module.exports = { mercadopago };
