'use strict';

const { pool } = require('../config/db');

async function inserir(conn, { tipo, usuarioId, tokenHash, ip, userAgent, expiraEm }) {
  const [r] = await conn.execute(
    `INSERT INTO sessoes_refresh (tipo_usuario, usuario_id, token_hash, ip, user_agent, expira_em)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tipo, usuarioId, tokenHash, ip ?? null, userAgent ?? null, expiraEm],
  );
  return String(r.insertId);
}

async function buscarPorId(id, tipo) {
  const [rows] = await pool.execute(
    `SELECT id, tipo_usuario, usuario_id, token_hash, expira_em, revogado_em
       FROM sessoes_refresh WHERE id = ? AND tipo_usuario = ?`,
    [id, tipo],
  );
  return rows[0] || null;
}

/** Revoga apenas se ainda ativa. Retorna true se esta chamada efetivamente revogou. */
async function revogar(conn, id) {
  const [r] = await conn.execute(
    'UPDATE sessoes_refresh SET revogado_em = UTC_TIMESTAMP() WHERE id = ? AND revogado_em IS NULL',
    [id],
  );
  return r.affectedRows === 1;
}

async function revogarTodasDoUsuario(tipo, usuarioId) {
  await pool.execute(
    `UPDATE sessoes_refresh SET revogado_em = UTC_TIMESTAMP()
      WHERE tipo_usuario = ? AND usuario_id = ? AND revogado_em IS NULL`,
    [tipo, usuarioId],
  );
}

module.exports = { inserir, buscarPorId, revogar, revogarTodasDoUsuario };
