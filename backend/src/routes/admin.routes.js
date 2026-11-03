'use strict';

const { Router } = require('express');
const { autenticar } = require('../middlewares/auth');
const { exigirPermissao } = require('../middlewares/rbac');

const router = Router();

// Tudo sob /admin exige JWT de administrador.
router.use(autenticar('admin'));

router.get('/me', (req, res) => {
  res.json({ usuario: req.usuario });
});

// Rotas de verificacao do RBAC (serao substituidas pelos modulos reais).
router.get('/produtos/ping', exigirPermissao('produtos.ler'), (_req, res) => {
  res.json({ ok: true, recurso: 'produtos' });
});

router.get('/financeiro/ping', exigirPermissao('notas.ler'), (_req, res) => {
  res.json({ ok: true, recurso: 'notas' });
});

module.exports = router;
