'use strict';

const s = require('../services/catalogo.admin.service');
const v = require('../validators/catalogo.validators');
const { idParams } = require('../validators/comum');

module.exports = {
  // produtos
  async listarProdutos(req, res) {
    res.json(await s.listarProdutos(v.listaAdmin.parse(req.query)));
  },
  async obterProduto(req, res) {
    res.json(await s.obterProduto(idParams.parse(req.params).id));
  },
  async criarProduto(req, res) {
    res.status(201).json(await s.criarProduto(req, v.produtoCriar.parse(req.body)));
  },
  async atualizarProduto(req, res) {
    res.json(await s.atualizarProduto(req, idParams.parse(req.params).id, v.produtoAtualizar.parse(req.body)));
  },
  async excluirProduto(req, res) {
    await s.excluirProduto(req, idParams.parse(req.params).id);
    res.status(204).end();
  },

  // variacoes
  async criarVariacao(req, res) {
    res.status(201).json(await s.criarVariacao(req, idParams.parse(req.params).id, v.variacaoCriar.parse(req.body)));
  },
  async atualizarVariacao(req, res) {
    res.json(await s.atualizarVariacao(req, idParams.parse(req.params).id, v.variacaoAtualizar.parse(req.body)));
  },
  async ajustarEstoque(req, res) {
    const { saldo } = v.estoqueSchema.parse(req.body);
    res.json(await s.ajustarEstoque(req, idParams.parse(req.params).id, saldo));
  },

  // imagens
  async adicionarImagem(req, res) {
    res.status(201).json(await s.adicionarImagem(req, idParams.parse(req.params).id, v.imagem.parse(req.body)));
  },
  async removerImagem(req, res) {
    await s.removerImagem(req, idParams.parse(req.params).id);
    res.status(204).end();
  },

  // marcas
  async listarMarcas(_req, res) {
    res.json({ itens: await s.listarMarcas() });
  },
  async criarMarca(req, res) {
    res.status(201).json(await s.criarMarca(req, v.marcaSchema.parse(req.body)));
  },
  async atualizarMarca(req, res) {
    await s.atualizarMarca(req, idParams.parse(req.params).id, v.marcaSchema.parse(req.body));
    res.status(204).end();
  },

  // categorias
  async listarCategorias(_req, res) {
    res.json({ itens: await s.listarCategorias() });
  },
  async criarCategoria(req, res) {
    res.status(201).json(await s.criarCategoria(req, v.categoriaSchema.parse(req.body)));
  },
  async atualizarCategoria(req, res) {
    await s.atualizarCategoria(req, idParams.parse(req.params).id, v.categoriaSchema.parse(req.body));
    res.status(204).end();
  },
};
