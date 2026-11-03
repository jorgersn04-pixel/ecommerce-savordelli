'use strict';

const rateLimit = require('express-rate-limit');

const mensagem = (codigo, texto) => ({ erro: { codigo, mensagem: texto } });

/** Anti forca-bruta: 10 tentativas FALHAS por IP a cada 15 min. */
const limiteLogin = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: mensagem('MUITAS_TENTATIVAS', 'Muitas tentativas. Tente novamente em alguns minutos'),
});

const limiteRefresh = rateLimit({
  windowMs: 15 * 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: mensagem('MUITAS_TENTATIVAS', 'Muitas requisicoes. Tente novamente em alguns minutos'),
});

module.exports = { limiteLogin, limiteRefresh };
