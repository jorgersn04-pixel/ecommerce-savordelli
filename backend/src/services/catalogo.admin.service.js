'use strict';

const AppError = require('../utils/AppError');
const { pool, withTransaction } = require('../config/db');
const { slugify } = require('../utils/formatos');
const repo = require('../repositories/produtos.repository');
const outbox = require('./bling-outbox.service');
const estoque = require('./estoque.service');
const { auditar } = require('./auditoria.service');

const naoEncontrado = () => new AppError(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto nao encontrado');

async function normalizarImagens(conn, produtoId, imagens) {
  // Garante exatamente uma imagem principal.
  const lista = imagens.map((i) => ({ ...i }));
  const idx = lista.findIndex((i) => i.principal);
  lista.forEach((i, n) => {
    i.principal = idx === -1 ? n === 0 : n === idx;
  });
  for (const img of lista) await repo.inserirImagem(conn, produtoId, img);
}

// ----------------------------------------------------------------- produtos
async function criarProduto(req, dados) {
  const id = await withTransaction(async (conn) => {
    const slug = await repo.slugUnico(conn, 'produtos', slugify(dados.nome));
    const produtoId = await repo.inserirProduto(conn, dados, slug);
    await repo.definirCategorias(conn, produtoId, dados.categorias_ids);
    for (const v of dados.variacoes) await repo.inserirVariacao(conn, produtoId, v);
    await normalizarImagens(conn, produtoId, dados.imagens);
    if (dados.status === 'ativo' && (await repo.contarVariacoesAtivas(conn, produtoId)) === 0) {
      throw new AppError(422, 'SEM_VARIACAO_ATIVA', 'Produto ativo precisa de ao menos uma variacao ativa');
    }
    await outbox.enfileirar(conn, 'produto', produtoId, 'criar');
    await auditar(conn, req, 'produto.criar', 'produto', produtoId, { nome: dados.nome });
    return produtoId;
  });
  return repo.buscarAdminPorId(id);
}

async function atualizarProduto(req, id, dados) {
  await withTransaction(async (conn) => {
    const atual = await repo.produtoExiste(conn, id);
    if (!atual) throw naoEncontrado();

    // Slug acompanha o nome apenas enquanto o produto e rascunho (URLs publicadas nao mudam).
    const slug = dados.nome && atual.status === 'rascunho'
      ? await repo.slugUnico(conn, 'produtos', slugify(dados.nome), id)
      : null;
    const { categorias_ids: categorias, ...campos } = dados;
    await repo.atualizarProduto(conn, id, campos, slug);
    if (categorias) await repo.definirCategorias(conn, id, categorias);

    const statusFinal = dados.status ?? atual.status;
    if (statusFinal === 'ativo' && (await repo.contarVariacoesAtivas(conn, id)) === 0) {
      throw new AppError(422, 'SEM_VARIACAO_ATIVA', 'Produto ativo precisa de ao menos uma variacao ativa');
    }
    await outbox.enfileirar(conn, 'produto', id, 'atualizar');
    await auditar(conn, req, 'produto.editar', 'produto', id, { campos: Object.keys(dados) });
  });
  return repo.buscarAdminPorId(id);
}

async function excluirProduto(req, id) {
  await withTransaction(async (conn) => {
    if (!(await repo.produtoExiste(conn, id))) throw naoEncontrado();
    await repo.softDelete(conn, id);
    await outbox.enfileirar(conn, 'produto', id, 'excluir');
    await auditar(conn, req, 'produto.excluir', 'produto', id);
  });
}

async function listarProdutos(filtros) {
  const { total, itens } = await repo.listarAdmin(filtros);
  return {
    itens,
    paginacao: { pagina: filtros.pagina, limite: filtros.limite, total, paginas: Math.ceil(total / filtros.limite) },
  };
}

async function obterProduto(id) {
  const p = await repo.buscarAdminPorId(id);
  if (!p) throw naoEncontrado();
  return p;
}

// ---------------------------------------------------------------- variacoes
async function criarVariacao(req, produtoId, dados) {
  return withTransaction(async (conn) => {
    if (!(await repo.produtoExiste(conn, produtoId))) throw naoEncontrado();
    const id = await repo.inserirVariacao(conn, produtoId, dados);
    await outbox.enfileirar(conn, 'produto', produtoId, 'atualizar');
    await auditar(conn, req, 'variacao.criar', 'variacao', id, { sku: dados.sku });
    return { id };
  });
}

async function atualizarVariacao(req, id, dados) {
  await withTransaction(async (conn) => {
    const [[atual]] = await conn.execute(
      `SELECT v.id, v.produto_id, v.preco, v.preco_promocional
         FROM produto_variacoes v JOIN produtos p ON p.id = v.produto_id
        WHERE v.id = ? AND p.excluido_em IS NULL FOR UPDATE`,
      [id],
    );
    if (!atual) throw new AppError(404, 'VARIACAO_NAO_ENCONTRADA', 'Variacao nao encontrada');

    // A regra "promocional < preco" precisa considerar o valor ja gravado.
    const preco = dados.preco ?? atual.preco;
    const promo = dados.preco_promocional === undefined ? atual.preco_promocional : dados.preco_promocional;
    if (promo != null && Number(promo) >= Number(preco)) {
      throw new AppError(422, 'PROMOCAO_INVALIDA', 'preco_promocional deve ser menor que preco');
    }
    await repo.atualizarVariacao(conn, id, dados);
    if (dados.ativo === false && (await repo.contarVariacoesAtivas(conn, atual.produto_id)) === 0) {
      throw new AppError(422, 'SEM_VARIACAO_ATIVA', 'O produto nao pode ficar sem variacao ativa');
    }
    await outbox.enfileirar(conn, 'produto', atual.produto_id, 'atualizar');
    await auditar(conn, req, 'variacao.editar', 'variacao', id, { campos: Object.keys(dados) });
  });
  const [[v]] = await pool.execute('SELECT * FROM produto_variacoes WHERE id = ?', [id]);
  return v;
}

async function ajustarEstoque(req, variacaoId, saldo) {
  const r = await estoque.ajustarSaldoAdmin(variacaoId, saldo);
  await auditar(null, req, 'estoque.ajustar', 'variacao', variacaoId, { saldo });
  return r;
}

// ------------------------------------------------------------------ imagens
async function adicionarImagem(req, produtoId, img) {
  return withTransaction(async (conn) => {
    if (!(await repo.produtoExiste(conn, produtoId))) throw naoEncontrado();
    const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM produto_imagens WHERE produto_id = ?', [produtoId]);
    const principal = img.principal || Number(n) === 0;
    const id = await repo.inserirImagem(conn, produtoId, { ...img, principal });
    if (principal) await repo.limparPrincipais(conn, produtoId, id);
    await auditar(conn, req, 'imagem.adicionar', 'produto', produtoId, { imagem_id: id });
    return { id };
  });
}

async function removerImagem(req, id) {
  await withTransaction(async (conn) => {
    const [[img]] = await conn.execute('SELECT id, produto_id, principal FROM produto_imagens WHERE id = ?', [id]);
    if (!img) throw new AppError(404, 'IMAGEM_NAO_ENCONTRADA', 'Imagem nao encontrada');
    await conn.execute('DELETE FROM produto_imagens WHERE id = ?', [id]);
    if (img.principal) {
      await conn.execute(
        `UPDATE produto_imagens SET principal = 1 WHERE produto_id = ?
          ORDER BY ordem, id LIMIT 1`,
        [img.produto_id],
      );
    }
    await auditar(conn, req, 'imagem.remover', 'produto', img.produto_id, { imagem_id: id });
  });
}

// ------------------------------------------------------ marcas e categorias
async function listarMarcas() {
  const [rows] = await pool.query('SELECT id, nome, slug, ativo FROM marcas ORDER BY nome');
  return rows;
}

async function criarMarca(req, { nome, ativo }) {
  return withTransaction(async (conn) => {
    const slug = await repo.slugUnico(conn, 'marcas', slugify(nome));
    const [r] = await conn.execute('INSERT INTO marcas (nome, slug, ativo) VALUES (?, ?, ?)', [nome, slug, ativo === false ? 0 : 1]);
    await auditar(conn, req, 'marca.criar', 'marca', r.insertId, { nome });
    return { id: String(r.insertId), nome, slug };
  });
}

async function atualizarMarca(req, id, { nome, ativo }) {
  const [r] = await pool.execute('UPDATE marcas SET nome = ?, ativo = COALESCE(?, ativo) WHERE id = ?', [
    nome, ativo === undefined ? null : Number(ativo), id,
  ]);
  if (r.affectedRows === 0) throw new AppError(404, 'MARCA_NAO_ENCONTRADA', 'Marca nao encontrada');
  await auditar(null, req, 'marca.editar', 'marca', id, { nome, ativo });
}

async function listarCategorias() {
  const [rows] = await pool.query('SELECT * FROM categorias ORDER BY pai_id, ordem, nome');
  return rows;
}

async function criarCategoria(req, d) {
  return withTransaction(async (conn) => {
    const slug = await repo.slugUnico(conn, 'categorias', slugify(d.nome));
    const [r] = await conn.execute(
      'INSERT INTO categorias (pai_id, nome, slug, ordem, ativo, bling_categoria_id) VALUES (?, ?, ?, ?, ?, ?)',
      [d.pai_id ?? null, d.nome, slug, d.ordem ?? 0, d.ativo === false ? 0 : 1, d.bling_categoria_id ?? null],
    );
    await auditar(conn, req, 'categoria.criar', 'categoria', r.insertId, { nome: d.nome });
    return { id: String(r.insertId), nome: d.nome, slug };
  });
}

async function atualizarCategoria(req, id, d) {
  if (d.pai_id && String(d.pai_id) === String(id)) {
    throw new AppError(422, 'CATEGORIA_CICLICA', 'Uma categoria nao pode ser pai de si mesma');
  }
  const [r] = await pool.execute(
    `UPDATE categorias SET nome = ?, pai_id = ?, ordem = COALESCE(?, ordem),
            ativo = COALESCE(?, ativo), bling_categoria_id = ? WHERE id = ?`,
    [d.nome, d.pai_id ?? null, d.ordem ?? null, d.ativo === undefined ? null : Number(d.ativo), d.bling_categoria_id ?? null, id],
  );
  if (r.affectedRows === 0) throw new AppError(404, 'CATEGORIA_NAO_ENCONTRADA', 'Categoria nao encontrada');
  await auditar(null, req, 'categoria.editar', 'categoria', id, d);
}

module.exports = {
  criarProduto, atualizarProduto, excluirProduto, listarProdutos, obterProduto,
  criarVariacao, atualizarVariacao, ajustarEstoque,
  adicionarImagem, removerImagem,
  listarMarcas, criarMarca, atualizarMarca,
  listarCategorias, criarCategoria, atualizarCategoria,
};
