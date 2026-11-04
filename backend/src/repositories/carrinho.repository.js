'use strict';

const { pool } = require('../config/db');
const { SQL_DISPONIVEL } = require('./catalogo.repository');

async function buscarAbertoPorToken(token) {
  const [rows] = await pool.execute("SELECT * FROM carrinhos WHERE token = ? AND status = 'aberto'", [token]);
  return rows[0] || null;
}

async function buscarAbertoDoCliente(clienteId) {
  const [rows] = await pool.execute(
    "SELECT * FROM carrinhos WHERE cliente_id = ? AND status = 'aberto' ORDER BY id DESC LIMIT 1",
    [clienteId],
  );
  return rows[0] || null;
}

async function criar(token, clienteId) {
  const [r] = await pool.execute('INSERT INTO carrinhos (token, cliente_id) VALUES (?, ?)', [token, clienteId ?? null]);
  return { id: String(r.insertId), token, cliente_id: clienteId ?? null, cep_destino: null, status: 'aberto' };
}

async function vincularCliente(carrinhoId, clienteId) {
  await pool.execute('UPDATE carrinhos SET cliente_id = ? WHERE id = ?', [clienteId, carrinhoId]);
}

async function itens(exec, carrinhoId) {
  const [rows] = await exec.query(
    `SELECT ci.variacao_id, ci.quantidade,
            v.sku, v.atributos, v.preco, v.preco_promocional, v.peso_g, v.altura_cm, v.largura_cm, v.comprimento_cm,
            v.ativo AS variacao_ativa, ${SQL_DISPONIVEL} AS disponivel,
            p.id AS produto_id, p.nome, p.slug, p.status, p.excluido_em,
            (SELECT i.url FROM produto_imagens i WHERE i.produto_id = p.id
              ORDER BY (i.variacao_id = v.id) DESC, i.principal DESC, i.ordem, i.id LIMIT 1) AS imagem
       FROM carrinho_itens ci
       JOIN produto_variacoes v ON v.id = ci.variacao_id
       JOIN produtos p ON p.id = v.produto_id
      WHERE ci.carrinho_id = ? ORDER BY ci.id`,
    [carrinhoId],
  );
  return rows;
}

async function buscarVariacaoVendavel(variacaoId) {
  const [rows] = await pool.execute(
    `SELECT v.id, ${SQL_DISPONIVEL} AS disponivel
       FROM produto_variacoes v JOIN produtos p ON p.id = v.produto_id
      WHERE v.id = ? AND v.ativo = 1 AND p.status = 'ativo' AND p.excluido_em IS NULL`,
    [variacaoId],
  );
  return rows[0] ? { id: String(rows[0].id), disponivel: Number(rows[0].disponivel) } : null;
}

async function definirQuantidade(carrinhoId, variacaoId, quantidade) {
  await pool.execute(
    `INSERT INTO carrinho_itens (carrinho_id, variacao_id, quantidade) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE quantidade = VALUES(quantidade)`,
    [carrinhoId, variacaoId, quantidade],
  );
  await tocar(carrinhoId);
}

async function quantidadeAtual(carrinhoId, variacaoId) {
  const [rows] = await pool.execute(
    'SELECT quantidade FROM carrinho_itens WHERE carrinho_id = ? AND variacao_id = ?',
    [carrinhoId, variacaoId],
  );
  return rows[0] ? rows[0].quantidade : 0;
}

async function remover(carrinhoId, variacaoId) {
  await pool.execute('DELETE FROM carrinho_itens WHERE carrinho_id = ? AND variacao_id = ?', [carrinhoId, variacaoId]);
  await tocar(carrinhoId);
}

async function limpar(carrinhoId) {
  await pool.execute('DELETE FROM carrinho_itens WHERE carrinho_id = ?', [carrinhoId]);
  await tocar(carrinhoId);
}

async function definirCep(carrinhoId, cep) {
  await pool.execute('UPDATE carrinhos SET cep_destino = ?, atualizado_em = UTC_TIMESTAMP() WHERE id = ?', [cep, carrinhoId]);
}

function tocar(carrinhoId) {
  return pool.execute('UPDATE carrinhos SET atualizado_em = UTC_TIMESTAMP() WHERE id = ?', [carrinhoId]);
}

/** Move itens do carrinho anonimo para o do cliente (soma quantidades) e descarta o anonimo. */
async function mesclar(origemId, destinoId) {
  await pool.execute(
    `INSERT INTO carrinho_itens (carrinho_id, variacao_id, quantidade)
     SELECT ?, o.variacao_id, o.quantidade FROM carrinho_itens o WHERE o.carrinho_id = ?
     ON DUPLICATE KEY UPDATE quantidade = carrinho_itens.quantidade + o.quantidade`,
    [destinoId, origemId],
  );
  await pool.execute("UPDATE carrinhos SET status = 'abandonado' WHERE id = ?", [origemId]);
  await pool.execute('DELETE FROM carrinho_itens WHERE carrinho_id = ?', [origemId]);
  await tocar(destinoId);
}

async function marcarConvertido(conn, carrinhoId) {
  await conn.execute("UPDATE carrinhos SET status = 'convertido' WHERE id = ?", [carrinhoId]);
}

module.exports = {
  buscarAbertoPorToken, buscarAbertoDoCliente, criar, vincularCliente, itens, buscarVariacaoVendavel,
  definirQuantidade, quantidadeAtual, remover, limpar, definirCep, mesclar, marcarConvertido,
};
