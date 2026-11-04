'use strict';

const s = require('../services/cliente.service');
const v = require('../validators/cliente.validators');
const { idParams } = require('../validators/comum');

module.exports = {
  async perfil(req, res) {
    res.json(await s.obterPerfil(req.usuario.id));
  },
  async atualizarPerfil(req, res) {
    res.json(await s.atualizarPerfil(req.usuario.id, v.atualizarPerfil.parse(req.body)));
  },
  async listarEnderecos(req, res) {
    res.json({ itens: await s.listarEnderecos(req.usuario.id) });
  },
  async criarEndereco(req, res) {
    res.status(201).json(await s.criarEndereco(req.usuario.id, v.endereco.parse(req.body)));
  },
  async atualizarEndereco(req, res) {
    res.json(await s.atualizarEndereco(req.usuario.id, idParams.parse(req.params).id, v.endereco.parse(req.body)));
  },
  async removerEndereco(req, res) {
    await s.removerEndereco(req.usuario.id, idParams.parse(req.params).id);
    res.status(204).end();
  },
};
