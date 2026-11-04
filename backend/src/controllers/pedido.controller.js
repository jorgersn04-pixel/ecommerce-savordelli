'use strict';

const s = require('../services/pedido.service');
const v = require('../validators/pedido.validators');
const { idParams } = require('../validators/comum');

module.exports = {
  // cliente
  async criar(req, res) {
    res.status(201).json(await s.criar(req, res, v.checkout.parse(req.body)));
  },
  async listar(req, res) {
    res.json(await s.listarDoCliente(req.usuario.id, v.listaCliente.parse(req.query)));
  },
  async detalhar(req, res) {
    res.json(await s.detalhar(v.numeroParams.parse(req.params).numero, req.usuario.id));
  },
  async pagar(req, res) {
    const { numero } = v.numeroParams.parse(req.params);
    res.json(await s.pagarPedido(numero, req.usuario.id, v.pagar.parse(req.body).pagamento));
  },
  async pagamento(req, res) {
    res.json(await s.pagamentoDoPedido(v.numeroParams.parse(req.params).numero, req.usuario.id));
  },
  async cancelar(req, res) {
    res.json(await s.cancelarPeloCliente(v.numeroParams.parse(req.params).numero, req.usuario.id));
  },

  // admin
  async listarAdmin(req, res) {
    res.json(await s.listarAdmin(v.listaAdmin.parse(req.query)));
  },
  async detalharAdmin(req, res) {
    res.json(await s.detalharAdmin(req, idParams.parse(req.params).id));
  },
  async atualizarStatus(req, res) {
    res.json(await s.atualizarStatusAdmin(req, idParams.parse(req.params).id, v.atualizarStatus.parse(req.body)));
  },
};
