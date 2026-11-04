'use strict';

const service = require('../services/catalogo.service');
const { listaPublica } = require('../validators/catalogo.validators');

module.exports = {
  async listar(req, res) {
    res.json(await service.listar(listaPublica.parse(req.query)));
  },
  async detalhar(req, res) {
    res.json(await service.detalhar(req.params.slug));
  },
  async categorias(_req, res) {
    res.json({ itens: await service.categorias() });
  },
  async marcas(_req, res) {
    res.json({ itens: await service.marcas() });
  },
};
