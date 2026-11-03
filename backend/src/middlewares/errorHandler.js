'use strict';

const { ZodError } = require('zod');
const logger = require('../config/logger');
const env = require('../config/env');
const AppError = require('../utils/AppError');

function notFound(req, _res, next) {
  next(new AppError(404, 'ROTA_NAO_ENCONTRADA', `Rota nao encontrada: ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      erro: { codigo: 'VALIDACAO', mensagem: 'Dados invalidos', detalhes: err.issues },
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: { codigo: 'JSON_INVALIDO', mensagem: 'Corpo JSON invalido' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ erro: { codigo: 'PAYLOAD_GRANDE', mensagem: 'Corpo da requisicao muito grande' } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({
      erro: { codigo: err.codigo, mensagem: err.message, detalhes: err.detalhes },
    });
  }

  (req.log || logger).error({ err }, 'erro nao tratado');
  return res.status(500).json({
    erro: {
      codigo: 'ERRO_INTERNO',
      mensagem: env.isProd ? 'Erro interno do servidor' : err.message,
    },
  });
}

module.exports = { notFound, errorHandler };
