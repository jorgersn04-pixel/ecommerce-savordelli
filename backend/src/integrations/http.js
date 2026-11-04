'use strict';

const logger = require('../config/logger');
const AppError = require('../utils/AppError');

/**
 * Cliente HTTP minimo para integracoes: timeout, JSON e erro padronizado.
 * Nunca registra corpo nem headers (podem conter token ou dados pessoais).
 */
async function requisitar(servico, url, { metodo = 'GET', headers = {}, corpo, timeoutMs = 10_000 } = {}) {
  const inicio = Date.now();
  let resp;
  try {
    resp = await fetch(url, {
      method: metodo,
      headers: { Accept: 'application/json', ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    logger.error({ servico, metodo, ms: Date.now() - inicio, motivo: err.name }, 'integracao: falha de rede');
    throw new AppError(502, 'INTEGRACAO_INDISPONIVEL', `Servico externo indisponivel (${servico})`);
  }
  const texto = await resp.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  logger.info({ servico, metodo, status: resp.status, ms: Date.now() - inicio }, 'integracao: resposta');
  return { status: resp.status, ok: resp.ok, json };
}

module.exports = { requisitar };
