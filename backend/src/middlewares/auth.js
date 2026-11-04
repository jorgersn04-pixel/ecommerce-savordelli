'use strict';

const AppError = require('../utils/AppError');
const { verificarAccessToken } = require('../services/token.service');

/**
 * Exige `Authorization: Bearer <jwt>` valido e nao expirado.
 * Popula req.usuario = { id, tipo, papel, permissoes }.
 * Opcional: restringe ao tipo de usuario ('admin' ou 'cliente').
 */
function autenticar(tipoExigido) {
  return (req, _res, next) => {
    const header = req.headers.authorization || '';
    const [esquema, token] = header.split(' ');
    if (esquema !== 'Bearer' || !token) {
      return next(new AppError(401, 'TOKEN_AUSENTE', 'Autenticacao necessaria'));
    }
    const usuario = verificarAccessToken(token); // lanca 401 se expirado/invalido
    if (tipoExigido && usuario.tipo !== tipoExigido) {
      return next(new AppError(403, 'ACESSO_NEGADO', 'Este recurso nao esta disponivel para o seu tipo de conta'));
    }
    req.usuario = usuario;
    return next();
  };
}

/**
 * Identifica o cliente se houver Bearer; sem header segue anonimo.
 * Token presente porem invalido/expirado responde 401 (o frontend deve renovar e repetir).
 * Tokens de admin sao ignorados (a loja trata como visitante).
 */
function autenticarOpcional(req, _res, next) {
  const [esquema, token] = (req.headers.authorization || '').split(' ');
  if (esquema !== 'Bearer' || !token) return next();
  const usuario = verificarAccessToken(token);
  if (usuario.tipo === 'cliente') req.usuario = usuario;
  return next();
}

module.exports = { autenticar, autenticarOpcional };
