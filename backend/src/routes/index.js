'use strict';

const { Router } = require('express');
const health = require('./health.routes');

const router = Router();

router.use('/health', health);
// Fase 1: router.use('/auth', ...), router.use('/admin', ...)

module.exports = router;
