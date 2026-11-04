'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../config/logger');
const { pool } = require('../config/db');
const bling = require('../integrations/bling');
const estoque = require('./estoque.service');

/** X-Bling-Signature-256: "sha256=" + HMAC-SHA256(client_secret, corpo bruto). */
function assinaturaValida(rawBody, cabecalho, segredo = env.BLING_CLIENT_SECRET) {
  if (!segredo || !cabecalho || !rawBody) return false;
  const esperado = `sha256=${crypto.createHmac('sha256', segredo).update(rawBody).digest('hex')}`;
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(cabecalho));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Grava o evento (idempotente por eventId). Retorna { id, novo }. */
async function registrar(corpo, rawBody) {
  const eventoId = String(corpo.eventId || crypto.createHash('sha256').update(rawBody || JSON.stringify(corpo)).digest('hex')).slice(0, 100);
  const [r] = await pool.execute(
    'INSERT IGNORE INTO bling_webhook_eventos (evento_id, tipo, payload) VALUES (?, ?, ?)',
    [eventoId, String(corpo.event || 'desconhecido').slice(0, 60), JSON.stringify(corpo)],
  );
  if (r.affectedRows === 1) return { id: String(r.insertId), novo: true };
  const [[existente]] = await pool.execute('SELECT id FROM bling_webhook_eventos WHERE evento_id = ?', [eventoId]);
  return { id: String(existente.id), novo: false };
}

function idDoProduto(dados = {}) {
  const c = dados.produto?.id ?? dados.idProduto ?? dados.produtoId ?? dados.id;
  return c === undefined || c === null ? null : String(c);
}

async function registrarLogEntrada(evento, resumo) {
  await pool.execute(
    'INSERT INTO bling_sync_logs (fila_id, direcao, endpoint, resumo) VALUES (NULL, ?, ?, ?)',
    ['entrada', `webhook:${evento.tipo}`, String(resumo).slice(0, 500)],
  );
}

/**
 * Eventos de estoque: o corpo do webhook apenas indica QUAL produto mudou; o saldo real e consultado
 * na API do Bling (mesmo principio do gateway de pagamento). Aplica o saldo local via aplicarSaldoBling.
 */
async function aplicarSaldoDoProduto(blingProdutoId) {
  const [[v]] = await pool.execute('SELECT id, estoque_disponivel FROM produto_variacoes WHERE bling_variacao_id = ?', [blingProdutoId]);
  if (!v) return 'produto do Bling sem SKU correspondente na loja (ignorado)';
  const saldos = await bling.saldos([blingProdutoId]);
  if (!saldos.has(blingProdutoId)) return 'Bling nao retornou saldo para o produto (ignorado)';
  const novo = saldos.get(blingProdutoId);
  if (novo === v.estoque_disponivel) return `saldo ja estava em ${novo}`;
  await estoque.aplicarSaldoBling(v.id, novo);
  return `saldo ${v.estoque_disponivel} -> ${novo}`;
}

async function processarEvento(id) {
  const [[ev]] = await pool.execute('SELECT * FROM bling_webhook_eventos WHERE id = ?', [id]);
  if (!ev || ev.processado_em) return;
  const corpo = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload;

  let resumo;
  if (/^stock\./.test(ev.tipo)) {
    const produtoId = idDoProduto(corpo.data);
    resumo = produtoId ? await aplicarSaldoDoProduto(produtoId) : 'evento de estoque sem id de produto (ignorado)';
  } else {
    resumo = 'evento nao tratado pela loja (ignorado)';
  }
  await pool.execute('UPDATE bling_webhook_eventos SET processado_em = UTC_TIMESTAMP() WHERE id = ?', [id]);
  await registrarLogEntrada(ev, resumo);
}

/** Reprocessa eventos gravados mas nao concluidos (falha momentanea na consulta ao Bling). */
async function processarPendentes(limite = 50) {
  const [rows] = await pool.query(
    `SELECT id FROM bling_webhook_eventos
      WHERE processado_em IS NULL AND recebido_em < UTC_TIMESTAMP() - INTERVAL 30 SECOND
      ORDER BY id LIMIT ?`,
    [limite],
  );
  let ok = 0;
  for (const { id } of rows) {
    try {
      await processarEvento(id);
      ok += 1;
    } catch (err) {
      logger.warn({ evento: id, erro: err.message }, 'bling webhook: reprocessamento falhou');
    }
  }
  return ok;
}

/** Reconciliacao completa: puxa os saldos de todos os SKUs ligados ao Bling e corrige divergencias. */
async function sincronizarEstoqueCompleto() {
  const [vars] = await pool.query(
    'SELECT id, bling_variacao_id, estoque_disponivel FROM produto_variacoes WHERE bling_variacao_id IS NOT NULL',
  );
  const saldos = await bling.saldos(vars.map((v) => String(v.bling_variacao_id)));
  let atualizadas = 0;
  for (const v of vars) {
    const novo = saldos.get(String(v.bling_variacao_id));
    if (novo !== undefined && novo !== v.estoque_disponivel) {
      await estoque.aplicarSaldoBling(v.id, novo);
      atualizadas += 1;
    }
  }
  return { verificadas: vars.length, atualizadas };
}

module.exports = { assinaturaValida, registrar, processarEvento, processarPendentes, sincronizarEstoqueCompleto };
