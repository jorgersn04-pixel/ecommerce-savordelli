'use strict';

const { pool } = require('../config/db');

const LIMITE_ESTOQUE_BAIXO = 5;

/** Indicadores do painel. Datas em UTC; "hoje" e o dia UTC corrente. */
async function resumo() {
  const [porStatus] = await pool.query('SELECT status, COUNT(*) AS n FROM pedidos GROUP BY status');
  const [[hoje]] = await pool.query(
    `SELECT COUNT(*) AS pedidos, COALESCE(SUM(CASE WHEN status NOT IN ('cancelado', 'aguardando_pagamento') THEN total END), 0) AS receita
       FROM pedidos WHERE criado_em >= UTC_DATE()`,
  );
  const [[mes]] = await pool.query(
    `SELECT COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS receita
       FROM pedidos WHERE status IN ('pago', 'em_separacao', 'enviado', 'entregue') AND criado_em >= UTC_TIMESTAMP() - INTERVAL 30 DAY`,
  );
  const [serie] = await pool.query(
    `SELECT DATE(criado_em) AS dia, COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS receita
       FROM pedidos WHERE status IN ('pago', 'em_separacao', 'enviado', 'entregue') AND criado_em >= UTC_DATE() - INTERVAL 13 DAY
      GROUP BY DATE(criado_em) ORDER BY dia`,
  );
  const [baixo] = await pool.query(
    `SELECT v.id, v.sku, p.nome, GREATEST(v.estoque_disponivel - v.estoque_reservado, 0) AS disponivel
       FROM produto_variacoes v JOIN produtos p ON p.id = v.produto_id
      WHERE v.ativo = 1 AND p.status = 'ativo' AND p.excluido_em IS NULL
        AND v.estoque_disponivel - v.estoque_reservado <= ?
      ORDER BY disponivel, p.nome LIMIT 10`,
    [LIMITE_ESTOQUE_BAIXO],
  );
  const [fila] = await pool.query('SELECT status, COUNT(*) AS n FROM bling_sync_fila GROUP BY status');
  const [[{ ativos }]] = await pool.query("SELECT COUNT(*) AS ativos FROM produtos WHERE status = 'ativo' AND excluido_em IS NULL");

  return {
    pedidos_por_status: Object.fromEntries(porStatus.map((r) => [r.status, Number(r.n)])),
    hoje: { pedidos: Number(hoje.pedidos), receita: Number(hoje.receita).toFixed(2) },
    ultimos_30_dias: { pedidos: Number(mes.pedidos), receita: Number(mes.receita).toFixed(2) },
    serie_14_dias: serie.map((s) => ({ dia: s.dia, pedidos: Number(s.pedidos), receita: Number(s.receita).toFixed(2) })),
    estoque_baixo: baixo.map((b) => ({ ...b, disponivel: Number(b.disponivel) })),
    limite_estoque_baixo: LIMITE_ESTOQUE_BAIXO,
    produtos_ativos: Number(ativos),
    fila_bling: Object.fromEntries(fila.map((f) => [f.status, Number(f.n)])),
  };
}

module.exports = { resumo };
