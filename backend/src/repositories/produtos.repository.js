'use strict';

const { pool } = require('../config/db');

const j = (v) => (v == null ? null : JSON.stringify(v));

/** Gera slug unico na tabela informada (sufixo -2, -3...). `ignorarId` permite manter o proprio slug. */
async function slugUnico(conn, tabela, base, ignorarId = null) {
  const b = base || 'item';
  for (let n = 1; n < 1000; n += 1) {
    const candidato = n === 1 ? b : `${b}-${n}`;
    const [rows] = await conn.query(`SELECT id FROM ${tabela} WHERE slug = ? AND id <> ?`, [candidato, ignorarId ?? 0]);
    if (rows.length === 0) return candidato;
  }
  throw new Error('Nao foi possivel gerar slug unico');
}

async function inserirProduto(conn, p, slug) {
  const [r] = await conn.execute(
    `INSERT INTO produtos (marca_id, nome, slug, descricao_curta, descricao, ncm, origem_fiscal, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.marca_id ?? null, p.nome, slug, p.descricao_curta ?? null, p.descricao ?? null, p.ncm ?? null, p.origem_fiscal ?? null, p.status],
  );
  return String(r.insertId);
}

const CAMPOS_PRODUTO = ['marca_id', 'nome', 'descricao_curta', 'descricao', 'ncm', 'origem_fiscal', 'status'];

async function atualizarProduto(conn, id, dados, slug) {
  const sets = [];
  const params = [];
  for (const c of CAMPOS_PRODUTO) {
    if (dados[c] !== undefined) {
      sets.push(`${c} = ?`);
      params.push(dados[c]);
    }
  }
  if (slug) {
    sets.push('slug = ?');
    params.push(slug);
  }
  if (sets.length === 0) return;
  await conn.execute(`UPDATE produtos SET ${sets.join(', ')} WHERE id = ? AND excluido_em IS NULL`, [...params, id]);
}

async function definirCategorias(conn, produtoId, categoriasIds) {
  await conn.execute('DELETE FROM produto_categorias WHERE produto_id = ?', [produtoId]);
  for (const cid of new Set(categoriasIds)) {
    await conn.execute('INSERT INTO produto_categorias (produto_id, categoria_id) VALUES (?, ?)', [produtoId, cid]);
  }
}

async function inserirVariacao(conn, produtoId, v) {
  const [r] = await conn.execute(
    `INSERT INTO produto_variacoes
       (produto_id, sku, ean, atributos, preco, preco_promocional, custo, peso_g,
        altura_cm, largura_cm, comprimento_cm, ativo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      produtoId, v.sku, v.ean ?? null, j(v.atributos), v.preco, v.preco_promocional ?? null, v.custo ?? null,
      v.peso_g, v.altura_cm, v.largura_cm, v.comprimento_cm, v.ativo === false ? 0 : 1,
    ],
  );
  return String(r.insertId);
}

const CAMPOS_VARIACAO = ['sku', 'ean', 'preco', 'preco_promocional', 'custo', 'peso_g', 'altura_cm', 'largura_cm', 'comprimento_cm'];

async function atualizarVariacao(conn, id, dados) {
  const sets = [];
  const params = [];
  for (const c of CAMPOS_VARIACAO) {
    if (dados[c] !== undefined) {
      sets.push(`${c} = ?`);
      params.push(dados[c]);
    }
  }
  if (dados.atributos !== undefined) {
    sets.push('atributos = ?');
    params.push(j(dados.atributos));
  }
  if (dados.ativo !== undefined) {
    sets.push('ativo = ?');
    params.push(dados.ativo ? 1 : 0);
  }
  if (sets.length === 0) return;
  await conn.execute(`UPDATE produto_variacoes SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

async function inserirImagem(conn, produtoId, img) {
  const [r] = await conn.execute(
    `INSERT INTO produto_imagens (produto_id, variacao_id, url, texto_alternativo, ordem, principal)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [produtoId, img.variacao_id ?? null, img.url, img.texto_alternativo ?? null, img.ordem ?? 0, img.principal ? 1 : 0],
  );
  return String(r.insertId);
}

async function limparPrincipais(conn, produtoId, exceptoId = null) {
  await conn.execute('UPDATE produto_imagens SET principal = 0 WHERE produto_id = ? AND id <> ?', [produtoId, exceptoId ?? 0]);
}

async function produtoExiste(exec, id) {
  const [rows] = await exec.execute('SELECT id, status FROM produtos WHERE id = ? AND excluido_em IS NULL', [id]);
  return rows[0] || null;
}

async function contarVariacoesAtivas(exec, produtoId) {
  const [[r]] = await exec.execute('SELECT COUNT(*) AS n FROM produto_variacoes WHERE produto_id = ? AND ativo = 1', [produtoId]);
  return Number(r.n);
}

async function listarAdmin({ q, status, pagina, limite }) {
  const where = ['p.excluido_em IS NULL'];
  const params = [];
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(p.nome LIKE ? OR EXISTS (SELECT 1 FROM produto_variacoes v WHERE v.produto_id = p.id AND v.sku LIKE ?))');
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  const w = where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM produtos p WHERE ${w}`, params);
  const [itens] = await pool.query(
    `SELECT p.id, p.nome, p.slug, p.status, p.marca_id, p.bling_produto_id, p.criado_em,
            (SELECT COUNT(*) FROM produto_variacoes v WHERE v.produto_id = p.id) AS variacoes,
            (SELECT COALESCE(SUM(v.estoque_disponivel), 0) FROM produto_variacoes v WHERE v.produto_id = p.id) AS estoque_total
       FROM produtos p WHERE ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [...params, limite, (pagina - 1) * limite],
  );
  return { total: Number(total), itens };
}

async function buscarAdminPorId(id) {
  const [[produto]] = await pool.execute('SELECT * FROM produtos WHERE id = ? AND excluido_em IS NULL', [id]);
  if (!produto) return null;
  const [variacoes] = await pool.execute('SELECT * FROM produto_variacoes WHERE produto_id = ? ORDER BY id', [id]);
  const [imagens] = await pool.execute('SELECT * FROM produto_imagens WHERE produto_id = ? ORDER BY principal DESC, ordem, id', [id]);
  const [cats] = await pool.execute('SELECT categoria_id FROM produto_categorias WHERE produto_id = ?', [id]);
  return { ...produto, variacoes, imagens, categorias_ids: cats.map((c) => String(c.categoria_id)) };
}

async function softDelete(conn, id) {
  await conn.execute("UPDATE produtos SET excluido_em = UTC_TIMESTAMP(), status = 'inativo' WHERE id = ? AND excluido_em IS NULL", [id]);
  await conn.execute('UPDATE produto_variacoes SET ativo = 0 WHERE produto_id = ?', [id]);
}

module.exports = {
  slugUnico,
  inserirProduto,
  atualizarProduto,
  definirCategorias,
  inserirVariacao,
  atualizarVariacao,
  inserirImagem,
  limparPrincipais,
  produtoExiste,
  contarVariacoesAtivas,
  listarAdmin,
  buscarAdminPorId,
  softDelete,
};
