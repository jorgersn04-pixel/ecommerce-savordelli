'use strict';

const crypto = require('crypto');
const env = require('../../config/env');
const logger = require('../../config/logger');
const { pool, withTransaction } = require('../../config/db');
const AppError = require('../../utils/AppError');
const { cifrar, decifrar, hmac } = require('../../utils/crypto');
const { requisitar } = require('../http');

const URL_AUTORIZAR = 'https://www.bling.com.br/Api/v3/oauth/authorize';
const URL_TOKEN = 'https://www.bling.com.br/Api/v3/oauth/token';
const MARGEM_MS = 60_000;

const basic = () => Buffer.from(`${env.BLING_CLIENT_ID}:${env.BLING_CLIENT_SECRET}`).toString('base64');

// ------------------------------------------------------------------- state
/** `state` assinado (anti-CSRF do fluxo OAuth): ts.nonce.assinatura, valido por 10 minutos. */
function gerarState() {
  const base = `${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
  return `${base}.${hmac(`bling-state:${base}`).slice(0, 32)}`;
}

function validarState(state) {
  const partes = String(state || '').split('.');
  if (partes.length !== 3) return false;
  const base = `${partes[0]}.${partes[1]}`;
  const esperado = hmac(`bling-state:${base}`).slice(0, 32);
  const a = Buffer.from(esperado);
  const b = Buffer.from(partes[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Date.now() - Number(partes[0]) < 10 * 60_000;
}

function urlAutorizacao() {
  const q = new URLSearchParams({ response_type: 'code', client_id: env.BLING_CLIENT_ID, state: gerarState() });
  return `${URL_AUTORIZAR}?${q}`;
}

// ------------------------------------------------------------------ tokens
async function solicitarToken(corpoForm) {
  const r = await requisitar('bling-oauth', URL_TOKEN, {
    metodo: 'POST',
    headers: { Authorization: `Basic ${basic()}`, 'enable-jwt': '1' },
    corpoForm,
  });
  if (!r.ok || !r.json?.access_token) {
    logger.error({ status: r.status, erro: r.json?.error?.type }, 'Bling OAuth recusou a requisicao');
    throw new AppError(503, 'BLING_AUTORIZACAO_INVALIDA', 'Autorizacao do Bling invalida ou expirada. Reconecte a conta');
  }
  return r.json;
}

async function salvar(conn, tokens) {
  const expiraEm = new Date(Date.now() + Number(tokens.expires_in || 21_600) * 1000);
  await conn.execute(
    `INSERT INTO bling_credenciais (id, access_token_cifrado, refresh_token_cifrado, expira_em)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE access_token_cifrado = VALUES(access_token_cifrado),
       refresh_token_cifrado = VALUES(refresh_token_cifrado), expira_em = VALUES(expira_em)`,
    [cifrar(tokens.access_token), cifrar(tokens.refresh_token), expiraEm],
  );
  return expiraEm;
}

/** Callback do OAuth: troca o `code` por tokens e guarda cifrados (chave fora do banco). */
async function conectar(code) {
  const tokens = await solicitarToken(
    new URLSearchParams({ grant_type: 'authorization_code', code, ...(env.BLING_REDIRECT_URI ? { redirect_uri: env.BLING_REDIRECT_URI } : {}) }).toString(),
  );
  await withTransaction((conn) => salvar(conn, tokens));
}

let renovando = null;

/** Refresh rotativo: o Bling invalida o refresh token anterior, entao so um processo pode renovar por vez. */
function renovar() {
  renovando ??= withTransaction(async (conn) => {
    const [[row]] = await conn.execute('SELECT * FROM bling_credenciais WHERE id = 1 FOR UPDATE');
    if (!row) throw new AppError(503, 'BLING_NAO_CONECTADO', 'Bling nao conectado');
    // Outra instancia pode ter renovado enquanto aguardavamos o lock.
    if (new Date(row.expira_em).getTime() - Date.now() > MARGEM_MS) return decifrar(row.access_token_cifrado);
    const tokens = await solicitarToken(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decifrar(row.refresh_token_cifrado) }).toString(),
    );
    await salvar(conn, tokens);
    return tokens.access_token;
  }).finally(() => {
    renovando = null;
  });
  return renovando;
}

async function obterAccessToken() {
  const [[row]] = await pool.execute('SELECT * FROM bling_credenciais WHERE id = 1');
  if (!row) throw new AppError(503, 'BLING_NAO_CONECTADO', 'Bling nao conectado. Autorize o aplicativo no painel');
  if (new Date(row.expira_em).getTime() - Date.now() > MARGEM_MS) return decifrar(row.access_token_cifrado);
  return renovar();
}

async function statusConexao() {
  const [[row]] = await pool.execute('SELECT expira_em, atualizado_em FROM bling_credenciais WHERE id = 1');
  return row ? { conectado: true, token_expira_em: row.expira_em, atualizado_em: row.atualizado_em } : { conectado: false };
}

module.exports = { urlAutorizacao, validarState, conectar, obterAccessToken, renovar, statusConexao };
