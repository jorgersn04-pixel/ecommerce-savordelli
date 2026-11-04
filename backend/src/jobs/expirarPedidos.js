'use strict';

const logger = require('../config/logger');
const pedidos = require('../services/pedido.service');

const INTERVALO_MS = 5 * 60_000;

async function executar() {
  try {
    const n = await pedidos.expirarPendentes();
    if (n > 0) logger.info({ expirados: n }, 'pedidos sem pagamento expirados');
  } catch (err) {
    logger.error({ err }, 'falha no job de expiracao de pedidos');
  }
}

/** Seguro com varias instancias: cada cancelamento e condicional e travado por linha. */
function iniciar() {
  const timer = setInterval(executar, INTERVALO_MS);
  timer.unref();
  return timer;
}

module.exports = { executar, iniciar };
