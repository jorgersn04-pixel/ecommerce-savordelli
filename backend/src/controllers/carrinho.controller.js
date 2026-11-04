'use strict';

const s = require('../services/carrinho.service');
const v = require('../validators/carrinho.validators');

module.exports = {
  async ver(req, res) {
    res.json(await s.visualizar(req, res, v.verCarrinho.parse(req.query).cupom));
  },
  async adicionar(req, res) {
    res.status(201).json(await s.adicionarItem(req, res, v.adicionarItem.parse(req.body)));
  },
  async definir(req, res) {
    const { variacaoId } = v.variacaoParams.parse(req.params);
    res.json(await s.definirItem(req, res, variacaoId, v.definirItem.parse(req.body).quantidade));
  },
  async remover(req, res) {
    res.json(await s.removerItem(req, res, v.variacaoParams.parse(req.params).variacaoId));
  },
  async esvaziar(req, res) {
    res.json(await s.esvaziar(req, res));
  },
  async cotarFrete(req, res) {
    res.json(await s.cotarFrete(req, res, v.cotarCarrinho.parse(req.body)));
  },
  async cotarAvulso(req, res) {
    res.json(await s.cotarAvulso(v.cotarAvulso.parse(req.body)));
  },
};
