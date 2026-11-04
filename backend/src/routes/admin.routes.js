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

module.exports = router;
