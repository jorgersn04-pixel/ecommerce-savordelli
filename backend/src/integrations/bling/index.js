'use strict';

const env = require('../../config/env');
const logger = require('../../config/logger');

/** Em producao sem BLING_CLIENT_ID o worker nao inicia; fora dela usa o Bling simulado. */
const configurado = Boolean(env.BLING_CLIENT_ID && env.BLING_CLIENT_SECRET);

let impl;
if (configurado) {
  impl = require('./real');
} else {
  if (!env.isProd) logger.warn('Bling sem credenciais: usando Bling SIMULADO');
  impl = require('./mock');
}

module.exports = { ...impl, configurado, auth: configurado ? require('./auth') : null };
