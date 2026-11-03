'use strict';

const { Router } = require('express');
const controllers = require('../controllers/auth.controller');
const { limiteLogin, limiteRefresh } = require('../middlewares/rateLimit');

const router = Router();

for (const tipo of ['cliente', 'admin']) {
  const c = controllers[tipo];
  router.post(`/${tipo}/login`, limiteLogin, c.login);
  router.post(`/${tipo}/refresh`, limiteRefresh, c.renovar);
  router.post(`/${tipo}/logout`, c.logout);
}

module.exports = router;
