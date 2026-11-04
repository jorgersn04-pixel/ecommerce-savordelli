'use strict';

const { Router } = require('express');
const logger = require('../config/logger');
const bling = require('../integrations/bling');

const router = Router();

/**
 * Redirecionamento do OAuth do Bling (navegador, sem Bearer): a autenticidade vem do `state` assinado.
 * O resultado volta para o painel por query string.
 */
router.get('/callback', async (req, res) => {
  const destino = (qs) => `/painel/app.html#/bling?${qs}`;
  if (!bling.configurado) return res.redirect(destino('erro=simulado'));
  const { code, state } = req.query;
  if (typeof code !== 'string' || !bling.auth.validarState(state)) return res.redirect(destino('erro=state'));
  try {
    await bling.auth.conectar(code);
    return res.redirect(destino('conectado=1'));
  } catch (err) {
    logger.error({ err: err.message }, 'falha ao conectar ao Bling');
    return res.redirect(destino('erro=autorizacao'));
  }
});

module.exports = router;
