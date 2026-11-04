'use strict';

const { pool } = require('../config/db');

const SQL_PRECO_EFETIVO =
  'IF(v.preco_promocional IS NOT NULL AND v.preco_promocional < v.preco, v.preco_promocional, v.preco)';
const SQL_DISPONIVEL = 'GREATEST(v.estoque_disponivel - v.estoque_reservado, 0)';

const ORDENACAO = {
  recentes: 'p.criado_em DESC, p.id DESC',
  preco_asc: 'ag.preco_min ASC, p.id ASC',
  preco_desc: 'ag.preco_min DESC, p.id ASC',
  nome: 'p.nome ASC',
};

function escaparLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Listagem publica: apenas produtos ativos, nao excluidos, com ao menos uma variacao ativa. */
async function listarPublico({ q, marca, categoria, ordem, pagina, limite }) {
  const where = ["p.status = 'ativo'", 'p.excluido_em IS NULL'];
  const params = [];

  if (q) {
    where.push('(MATCH(p.nome, p.descricao_curta) AGAINST(? IN NATURAL LANGUAGE MODE) OR p.nome LIKE ?)');
    params.push(q, `%${escaparLike(q)}%`);
  }
  if (marca) {
    where.push('m.slug = ?');
    params.push(marca);
  }
  if (categoria) {
    where.push(`EXISTS (
      SELECT 1 FROM produto_categorias pc JOIN categorias c ON c.id = pc.categoria_id
       WHERE pc.produto_id = p.id AND c.ativo = 1
         AND (c.slug = ? OR c.pai_id = (SELECT id FROM categorias WHERE slug = ?)))`);
    params.push(categoria, categoria);
  }

  const from = `
    FROM produtos p
    JOIN (SELECT v.produto_id,
                 MIN(${SQL_PRECO_EFETIVO}) AS preco_min,
                 MIN(v.preco) AS preco_cheio_min,
                 SUM(${SQL_DISPONIVEL}) AS em_estoque
            FROM produto_variacoes v WHERE v.ativo = 1 GROUP BY v.produto_id) ag ON ag.produto_id = p.id
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, params);
  const [itens] = await pool.query(
    `SELECT p.id, p.nome, p.slug, p.descricao_curta,
            m.nome AS marca_nome, m.slug AS marca_slug,
            ag.preco_min, ag.preco_cheio_min, (ag.em_estoque > 0) AS disponivel,
            (SELECT i.url FROM produto_imagens i WHERE i.produto_id = p.id
              ORDER BY i.principal DESC, i.ordem ASC, i.id ASC LIMIT 1) AS imagem
     ${from} ORDER BY ${ORDENACAO[ordem]} LIMIT ? OFFSET ?`,
    [...params, limite, (pagina - 1) * limite],
  );
  return { total: Number(total), itens: itens.map((i) => ({ ...i, disponivel: Boolean(Number(i.disponivel)) })) };
}

async function buscarPublicoPorSlug(slug) {
  const [[produto]] = await pool.execute(
    `SELECT p.id, p.nome, p.slug, p.descricao_curta, p.descricao,
            m.nome AS marca_nome, m.slug AS marca_slug
       FROM produtos p LEFT JOIN marcas m ON m.id = p.marca_id
      WHERE p.slug = ? AND p.status = 'ativo' AND p.excluido_em IS NULL`,
    [slug],
  );
  if (!produto) return null;

  const [variacoes] = await pool.execute(
    `SELECT v.id, v.sku, v.ean, v.atributos, v.preco, v.preco_promocional,
            v.peso_g, ${SQL_DISPONIVEL} AS disponivel
       FROM produto_variacoes v WHERE v.produto_id = ? AND v.ativo = 1 ORDER BY v.id`,
    [produto.id],
  );
  const [imagens] = await pool.execute(
    `SELECT id, variacao_id, url, texto_alternativo, ordem, principal
       FROM produto_imagens WHERE produto_id = ? ORDER BY principal DESC, ordem, id`,
    [produto.id],
  );
  const [categorias] = await pool.execute(
    `SELECT c.id, c.nome, c.slug FROM produto_categorias pc
       JOIN categorias c ON c.id = pc.categoria_id WHERE pc.produto_id = ? AND c.ativo = 1`,
    [produto.id],
  );
  return {
    ...produto,
    variacoes: variacoes.map((v) => ({ ...v, disponivel: Number(v.disponivel) })),
    imagens,
    categorias,
  };
}

async function listarCategoriasPublicas() {
  const [rows] = await pool.query(
    'SELECT id, pai_id, nome, slug, ordem FROM categorias WHERE ativo = 1 ORDER BY ordem, nome',
  );
  return rows;
}

async function listarMarcasPublicas() {
  const [rows] = await pool.query('SELECT id, nome, slug FROM marcas WHERE ativo = 1 ORDER BY nome');
  return rows;
}

module.exports = {
  listarPublico,
  buscarPublicoPorSlug,
  listarCategoriasPublicas,
  listarMarcasPublicas,
  SQL_PRECO_EFETIVO,
  SQL_DISPONIVEL,
};
