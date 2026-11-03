'use strict';

const { Router } = require('express');
const { ping } = require('../config/db');

const router = Router();

// Liveness: processo no ar.
router.get('/', (_req, res) => {
  res.json({ status: 'ok', uptime_s: Math.round(process.uptime()), timestamp: new Date().toISOString() });
});

// Readiness: depende do banco.
router.get('/db', async (req, res) => {
  try {
    await ping();
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    req.log.error({ err }, 'health db falhou');
    res.status(503).json({ status: 'degradado', db: 'indisponivel' });
  }
});

module.exports = router;
