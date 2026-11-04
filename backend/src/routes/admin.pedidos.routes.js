'use strict';

const { Router } = require('express');
const c = require('../controllers/pedido.controller');
const { exigirPermissao: perm } = require('../middlewares/rbac');

const router = Router();

router.get('/pedidos', perm('pedidos.ler'), c.listarAdmin);
router.get('/pedidos/:id', perm('pedidos.ler'), c.detalharAdmin);
router.put('/pedidos/:id/status', perm('pedidos.atualizar'), c.atualizarStatus);

module.exports = router;
