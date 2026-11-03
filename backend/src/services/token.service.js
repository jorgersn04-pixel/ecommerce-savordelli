'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { hashToken } = require('../utils/password');
const argon2 = require('argon2');
const sessoes = require('../repositories/sessoes.repository');

const ISSUER = 'savordelli';

/** JWT de acesso (curta duracao). Payload: sub, tipo, papel e permissoes (admin). */
function gerarAccessToken({ id, tipo, papel = null, permissoes = [] }) {
  return jwt.sign({ tipo, papel, perm: permissoes }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    issuer: ISSUER,
    subject: String(id),
    expiresIn: env.JWT_ACCESS_TTL,
  });
}

/** Lanca AppError 401 (TOKEN_EXPIRADO ou TOKEN_INVALIDO). */
function verificarAccessToken(token) {
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER });
    return { id: p.sub, tipo: p.tipo, papel: p.papel, permissoes: p.perm || [] };
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new AppError(401, 'TOKEN_EXPIRADO', 'Token de acesso expirado');
    throw new AppError(401, 'TOKEN_INVALIDO', 'Token de acesso invalido');
  }
}

function expiracaoRefresh() {
  return new Date(Date.now() + env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Gera segredo aleatorio e seu hash Argon2id (fora de transacao: e CPU/memoria intensivo). */
async function prepararRefresh() {
  const segredo = crypto.randomBytes(32).toString('base64url');
  return { segredo, tokenHash: await hashToken(segredo) };
}

/** Cria sessao e devolve o refresh token no formato `<idSessao>.<segredo>`. */
async function criarRefreshToken({ tipo, usuarioId, ip, userAgent }) {
  const { segredo, tokenHash } = await prepararRefresh();
  const expiraEm = expiracaoRefresh();
  const conn = await pool.getConnection();
  try {
    const id = await sessoes.inserir(conn, { tipo, usuarioId, tokenHash, ip, userAgent, expiraEm });
    return { token: `${id}.${segredo}`, expiraEm };
  } finally {
    conn.release();
  }
}

function separarToken(token) {
  if (typeof token !== 'string') return null;
  const m = /^(\d{1,20})\.([A-Za-z0-9_-]{20,100})$/.exec(token);
  return m ? { id: m[1], segredo: m[2] } : null;
}

const invalido = () => new AppError(401, 'REFRESH_INVALIDO', 'Sessao invalida ou expirada');

/**
 * Valida o refresh token e o rotaciona: revoga a sessao atual e cria outra.
 * Reuso de token ja revogado indica vazamento: todas as sessoes do usuario sao revogadas.
 * Retorna { usuarioId, refresh: { token, expiraEm } }.
 */
async function rotacionarRefreshToken({ tipo, token, ip, userAgent }) {
  const partes = separarToken(token);
  if (!partes) throw invalido();

  const sessao = await sessoes.buscarPorId(partes.id, tipo);
  if (!sessao) throw invalido();

  if (sessao.revogado_em) {
    await sessoes.revogarTodasDoUsuario(tipo, sessao.usuario_id);
    throw new AppError(401, 'REFRESH_REUTILIZADO', 'Sessao encerrada por seguranca. Faca login novamente');
  }
  if (new Date(sessao.expira_em) <= new Date()) throw invalido();

  let confere = false;
  try {
    confere = await argon2.verify(sessao.token_hash, partes.segredo);
  } catch {
    confere = false;
  }
  if (!confere) throw invalido();

  const novo = await prepararRefresh();
  const expiraEm = expiracaoRefresh();

  const novoId = await withTransaction(async (conn) => {
    const revogou = await sessoes.revogar(conn, sessao.id);
    if (!revogou) return null; // outra requisicao rotacionou primeiro
    return sessoes.inserir(conn, {
      tipo,
      usuarioId: sessao.usuario_id,
      tokenHash: novo.tokenHash,
      ip,
      userAgent,
      expiraEm,
    });
  });
  if (!novoId) throw invalido();

  return { usuarioId: String(sessao.usuario_id), refresh: { token: `${novoId}.${novo.segredo}`, expiraEm } };
}

/** Revoga a sessao do token informado (se o segredo conferir). Silencioso se invalido. */
async function revogarRefreshToken({ tipo, token }) {
  const partes = separarToken(token);
  if (!partes) return;
  const sessao = await sessoes.buscarPorId(partes.id, tipo);
  if (!sessao || sessao.revogado_em) return;
  let confere = false;
  try {
    confere = await argon2.verify(sessao.token_hash, partes.segredo);
  } catch {
    confere = false;
  }
  if (!confere) return;
  await withTransaction((conn) => sessoes.revogar(conn, sessao.id));
}

module.exports = {
  gerarAccessToken,
  verificarAccessToken,
  criarRefreshToken,
  rotacionarRefreshToken,
  revogarRefreshToken,
};
