'use strict';

const { Router } = require('express');
const { autenticar } = require('../middlewares/auth');

const router = Router();

// Tudo sob /admin exige JWT de administrador.
router.use(autenticar('admin'));

router.get('/me', (req, res) => {
  res.json({ usuario: req.usuario });
});

router.use(require('./admin.catalogo.routes'));
router.use(require('./admin.cupons.routes'));
router.use(require('./admin.pedidos.routes'));
router.use(require('./admin.bling.routes'));

router.get('/dashboard', async (_req, res) => {
  res.json(await require('../services/dashboard.service').resumo());
});

module.exports = router;
