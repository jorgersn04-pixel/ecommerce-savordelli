'use strict';

const AppError = require('../utils/AppError');
const repo = require('../repositories/catalogo.repository');

async function listar(filtros) {
  const { total, itens } = await repo.listarPublico(filtros);
  return {
    itens,
    paginacao: {
      pagina: filtros.pagina,
      limite: filtros.limite,
      total,
      paginas: Math.ceil(total / filtros.limite),
    },
  };
}

async function detalhar(slug) {
  const produto = await repo.buscarPublicoPorSlug(slug);
  if (!produto) throw new AppError(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto nao encontrado');
  return produto;
}

module.exports = {
  listar,
  detalhar,
  categorias: repo.listarCategoriasPublicas,
  marcas: repo.listarMarcasPublicas,
};
