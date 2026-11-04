'use strict';

const { Router } = require('express');
const s = require('../services/cupom.admin.service');
const { cupomAdmin } = require('../validators/carrinho.validators');
const { idParams } = require('../validators/comum');
const { exigirPermissao: perm } = require('../middlewares/rbac');

const router = Router();

router.get('/cupons', perm('cupons.ler'), async (_req, res) => {
  res.json({ itens: await s.listar() });
});
router.post('/cupons', perm('cupons.gerenciar'), async (req, res) => {
  res.status(201).json(await s.criar(req, cupomAdmin.parse(req.body)));
});
router.put('/cupons/:id', perm('cupons.gerenciar'), async (req, res) => {
  await s.atualizar(req, idParams.parse(req.params).id, cupomAdmin.parse(req.body));
  res.status(204).end();
});

module.exports = router;
