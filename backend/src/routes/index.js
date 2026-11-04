'use strict';

const { Router } = require('express');
const health = require('./health.routes');

const router = Router();

router.use('/health', health);
router.use('/auth', require('./auth.routes'));
router.use('/admin', require('./admin.routes'));
router.use('/catalogo', require('./catalogo.routes'));
router.use(require('./carrinho.routes'));
router.use('/cliente', require('./cliente.routes'));
router.use('/pedidos', require('./pedidos.routes'));
router.use('/webhooks', require('./webhooks.routes'));

module.exports = router;
