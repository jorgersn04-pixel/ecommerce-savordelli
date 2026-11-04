'use strict';

const { pool } = require('../config/db');

const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

function hidratar(p) {
  if (!p) return null;
  return { ...p, snapshot_cliente: j(p.snapshot_cliente), snapshot_endereco: j(p.snapshot_endereco) };
}

async function buscarPorNumero(exec, numero, clienteId = null, travar = false) {
  const [rows] = await exec.execute(
    `SELECT * FROM pedidos WHERE numero = ?${clienteId ? ' AND cliente_id = ?' : ''}${travar ? ' FOR UPDATE' : ''}`,
    clienteId ? [numero, clienteId] : [numero],
  );
  return hidratar(rows[0]);
}

async function buscarPorId(exec, id, travar = false) {
  const [rows] = await exec.execute(`SELECT * FROM pedidos WHERE id = ?${travar ? ' FOR UPDATE' : ''}`, [id]);
  return hidratar(rows[0]);
}

async function itens(exec, pedidoId) {
  const [rows] = await exec.execute(
    'SELECT id, variacao_id, sku, nome, quantidade, preco_unitario, total FROM pedido_itens WHERE pedido_id = ? ORDER BY id',
    [pedidoId],
  );
  return rows;
}

async function historico(exec, pedidoId) {
  const [rows] = await exec.execute(
    'SELECT status_de, status_para, autor, observacao, criado_em FROM pedido_historico_status WHERE pedido_id = ? ORDER BY id',
    [pedidoId],
  );
  return rows;
}

async function pagamentos(exec, pedidoId) {
  const [rows] = await exec.execute(
    `SELECT id, metodo, provedor, provedor_transacao_id, valor, parcelas, status, pago_em, criado_em
       FROM pagamentos WHERE pedido_id = ? ORDER BY id`,
    [pedidoId],
  );
  return rows;
}

async function envios(exec, pedidoId) {
  const [rows] = await exec.execute(
    'SELECT servico, codigo_rastreio, status, postado_em, entregue_em FROM envios WHERE pedido_id = ? ORDER BY id',
    [pedidoId],
  );
  return rows;
}

async function registrarHistorico(conn, pedidoId, de, para, autor, observacao = null) {
  await conn.execute(
    'INSERT INTO pedido_historico_status (pedido_id, status_de, status_para, autor, observacao) VALUES (?, ?, ?, ?, ?)',
    [pedidoId, de, para, autor, observacao],
  );
}

async function listarDoCliente(clienteId, { pagina, limite }) {
  const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM pedidos WHERE cliente_id = ?', [clienteId]);
  const [rows] = await pool.query(
    `SELECT p.numero, p.status, p.subtotal, p.desconto, p.frete_valor, p.total, p.criado_em,
            (SELECT COALESCE(SUM(i.quantidade), 0) FROM pedido_itens i WHERE i.pedido_id = p.id) AS quantidade_itens
       FROM pedidos p WHERE p.cliente_id = ? ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [clienteId, limite, (pagina - 1) * limite],
  );
  return { total: Number(total), itens: rows };
}

async function listarAdmin({ status, q, pagina, limite }) {
  const where = ['1 = 1'];
  const params = [];
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(p.numero LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(p.snapshot_cliente, \'$.email\')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(p.snapshot_cliente, \'$.nome\')) LIKE ?)');
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  const w = where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM pedidos p WHERE ${w}`, params);
  const [rows] = await pool.query(
    `SELECT p.id, p.numero, p.status, p.total, p.frete_servico, p.criado_em, p.bling_pedido_id,
            JSON_UNQUOTE(JSON_EXTRACT(p.snapshot_cliente, '$.nome')) AS cliente_nome
       FROM pedidos p WHERE ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [...params, limite, (pagina - 1) * limite],
  );
  return { total: Number(total), itens: rows };
}

module.exports = {
  buscarPorNumero, buscarPorId, itens, historico, pagamentos, envios, registrarHistorico, listarDoCliente, listarAdmin,
};
