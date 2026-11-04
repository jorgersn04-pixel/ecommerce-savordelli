'use strict';

const { Router } = require('express');
const c = require('../controllers/catalogo.controller');

// Publico (loja). Sem autenticacao.
const router = Router();

router.get('/produtos', c.listar);
router.get('/produtos/:slug', c.detalhar);
router.get('/categorias', c.categorias);
router.get('/marcas', c.marcas);

module.exports = router;
