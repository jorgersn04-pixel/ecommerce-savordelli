'use strict';

const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const { auditar } = require('./auditoria.service');

async function listar() {
  const [rows] = await pool.query('SELECT * FROM cupons ORDER BY id DESC');
  return rows;
}

async function criar(req, c) {
  const [r] = await pool.execute(
    `INSERT INTO cupons (codigo, tipo, valor, pedido_minimo, limite_usos, valido_de, valido_ate, ativo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.codigo, c.tipo, c.valor, c.pedido_minimo ?? null, c.limite_usos ?? null, c.valido_de ?? null, c.valido_ate ?? null, c.ativo ? 1 : 0],
  );
  await auditar(null, req, 'cupom.criar', 'cupom', r.insertId, { codigo: c.codigo });
  return { id: String(r.insertId), codigo: c.codigo };
}

async function atualizar(req, id, c) {
  const [r] = await pool.execute(
    `UPDATE cupons SET codigo = ?, tipo = ?, valor = ?, pedido_minimo = ?, limite_usos = ?,
            valido_de = ?, valido_ate = ?, ativo = ? WHERE id = ?`,
    [c.codigo, c.tipo, c.valor, c.pedido_minimo ?? null, c.limite_usos ?? null, c.valido_de ?? null, c.valido_ate ?? null, c.ativo ? 1 : 0, id],
  );
  if (r.affectedRows === 0) throw new AppError(404, 'CUPOM_NAO_ENCONTRADO', 'Cupom nao encontrado');
  await auditar(null, req, 'cupom.editar', 'cupom', id, { codigo: c.codigo });
}

module.exports = { listar, criar, atualizar };
