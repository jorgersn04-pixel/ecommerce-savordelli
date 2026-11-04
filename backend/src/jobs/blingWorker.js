'use strict';

const env = require('../config/env');
const logger = require('../config/logger');
const bling = require('../integrations/bling');
const sync = require('../services/bling-sync.service');
const webhook = require('../services/bling-webhook.service');

const CICLO_MS = 15_000;
const RECONCILIACAO_MS = 6 * 3_600_000;

let emExecucao = false;

async function ciclo() {
  if (emExecucao) return; // nunca sobrepoe ciclos
  emExecucao = true;
  try {
    const r = await sync.executarCiclo();
    if (r.processados > 0) logger.info(r, 'bling: ciclo da fila');
    await webhook.processarPendentes();
  } catch (err) {
    logger.error({ err }, 'bling: falha no ciclo do worker');
  } finally {
    emExecucao = false;
  }
}

async function reconciliar() {
  try {
    const r = await webhook.sincronizarEstoqueCompleto();
    logger.info(r, 'bling: reconciliacao de estoque');
  } catch (err) {
    logger.error({ err }, 'bling: reconciliacao de estoque falhou');
  }
}

/** Inicia o worker (outbox -> Bling) e a reconciliacao periodica de estoque (Bling -> loja). */
function iniciar() {
  if (env.BLING_WORKER === 'off') return [];
  if (!bling.configurado && env.isProd) {
    logger.error('BLING_CLIENT_ID/SECRET ausentes: worker do Bling NAO iniciado');
    return [];
  }
  const timers = [setInterval(ciclo, CICLO_MS)];
  if (bling.configurado) timers.push(setInterval(reconciliar, RECONCILIACAO_MS));
  timers.forEach((t) => t.unref());
  return timers;
}

module.exports = { iniciar, ciclo, reconciliar };
