'use strict';

const { pool } = require('../config/db');

function normalizarPermissoes(valor) {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === 'string') {
    try {
      return JSON.parse(valor);
    } catch {
      return [];
    }
  }
  return [];
}

async function buscarClientePorEmail(email) {
  const [rows] = await pool.execute(
    'SELECT id, nome, email, senha_hash, anonimizado_em FROM clientes WHERE email = ?',
    [email],
  );
  return rows[0] || null;
}

async function buscarClientePorId(id) {
  const [rows] = await pool.execute(
    'SELECT id, nome, email, anonimizado_em FROM clientes WHERE id = ?',
    [id],
  );
  return rows[0] || null;
}

const SQL_ADMIN = `
  SELECT a.id, a.nome, a.email, a.senha_hash, a.ativo, p.nome AS papel, p.permissoes
    FROM admin_usuarios a
    JOIN papeis p ON p.id = a.papel_id`;

async function buscarAdminPorEmail(email) {
  const [rows] = await pool.execute(`${SQL_ADMIN} WHERE a.email = ?`, [email]);
  if (!rows[0]) return null;
  return { ...rows[0], permissoes: normalizarPermissoes(rows[0].permissoes) };
}

async function buscarAdminPorId(id) {
  const [rows] = await pool.execute(`${SQL_ADMIN} WHERE a.id = ?`, [id]);
  if (!rows[0]) return null;
  return { ...rows[0], permissoes: normalizarPermissoes(rows[0].permissoes) };
}

async function registrarLoginAdmin(id) {
  await pool.execute('UPDATE admin_usuarios SET ultimo_login_em = UTC_TIMESTAMP() WHERE id = ?', [id]);
}

module.exports = {
  buscarClientePorEmail,
  buscarClientePorId,
  buscarAdminPorEmail,
  buscarAdminPorId,
  registrarLoginAdmin,
};
