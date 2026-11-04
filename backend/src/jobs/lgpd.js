'use strict';

const logger = require('../config/logger');
const lgpd = require('../services/lgpd.service');

const INTERVALO_MS = 24 * 3_600_000;

async function executar() {
  try {
    const n = await lgpd.expurgarSnapshotsVencidos();
    if (n > 0) logger.info({ pedidos: n }, 'lgpd: snapshots vencidos expurgados');
  } catch (err) {
    logger.error({ err }, 'lgpd: falha no expurgo de snapshots');
  }
}

/** Expurgo diario dos dados mantidos apenas pela guarda fiscal (5 anos). Idempotente. */
function iniciar() {
  setTimeout(executar, 60_000).unref();
  const timer = setInterval(executar, INTERVALO_MS);
  timer.unref();
  return timer;
}

module.exports = { iniciar, executar };
