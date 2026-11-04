'use strict';

const { Router } = require('express');
const c = require('../controllers/webhook.controller');

const router = Router();

router.post('/mercadopago', c.mercadopago);

module.exports = router;
