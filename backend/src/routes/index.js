'use strict';

const { Router } = require('express');
const health = require('./health.routes');

const router = Router();

router.use('/health', health);
router.use('/auth', require('./auth.routes'));
router.use('/admin', require('./admin.routes'));

module.exports = router;
