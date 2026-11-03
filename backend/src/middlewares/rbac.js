'use strict';

const AppError = require('../utils/AppError');

/**
 * Uma permissao concedida atende a requerida quando:
 *  - e '*'                       (tudo)
 *  - e igual                     ('pedidos.ler' == 'pedidos.ler')
 *  - termina em '.*' e o prefixo coincide ('produtos.*' cobre 'produtos.ler' e 'produtos.estoque.ajustar')
 */
function concede(concedida, requerida) {
  if (concedida === '*' || concedida === requerida) return true;
  if (concedida.endsWith('.*')) return requerida.startsWith(concedida.slice(0, -1));
  return false;
}

function temPermissao(permissoes, requerida) {
  return Array.isArray(permissoes) && permissoes.some((p) => typeof p === 'string' && concede(p, requerida));
}

/** Exige TODAS as permissoes listadas. Deve vir depois de autenticar(). */
function exigirPermissao(...requeridas) {
  return (req, _res, next) => {
    if (!req.usuario) return next(new AppError(401, 'TOKEN_AUSENTE', 'Autenticacao necessaria'));
    const ok = requeridas.every((r) => temPermissao(req.usuario.permissoes, r));
    if (!ok) return next(new AppError(403, 'ACESSO_NEGADO', 'Voce nao tem permissao para esta acao'));
    return next();
  };
}

module.exports = { exigirPermissao, temPermissao };
