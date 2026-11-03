'use strict';

const { z } = require('zod');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { ipParaBuffer } = require('../utils/ip');
const authService = require('../services/auth.service');
const { revogarRefreshToken } = require('../services/token.service');

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(190),
  senha: z.string().min(1).max(200),
});

const contexto = (req) => ({
  ip: ipParaBuffer(req.ip),
  userAgent: (req.get('user-agent') || '').slice(0, 255) || null,
});

/**
 * Cria os handlers de um tipo de usuario. O refresh token trafega apenas em cookie
 * httpOnly (nunca no JSON), com escopo de path restrito a /auth/<tipo>.
 */
function criarController(tipo, { login, renovar }) {
  const cookieNome = `sv_refresh_${tipo}`;
  const cookiePath = `/auth/${tipo}`;
  const opcoesCookie = (expiraEm) => ({
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    path: cookiePath,
    expires: expiraEm,
  });

  function responder(res, resultado, status = 200) {
    const { refresh, ...corpo } = resultado;
    res.cookie(cookieNome, refresh.token, opcoesCookie(refresh.expiraEm));
    res.status(status).json(corpo);
  }

  return {
    async login(req, res) {
      const dados = loginSchema.parse(req.body);
      responder(res, await login(dados, contexto(req)));
    },

    async renovar(req, res) {
      const token = req.cookies?.[cookieNome];
      if (!token) throw new AppError(401, 'REFRESH_AUSENTE', 'Sessao nao encontrada');
      try {
        responder(res, await renovar(token, contexto(req)));
      } catch (err) {
        res.clearCookie(cookieNome, { path: cookiePath });
        throw err;
      }
    },

    async logout(req, res) {
      const token = req.cookies?.[cookieNome];
      if (token) await revogarRefreshToken({ tipo, token });
      res.clearCookie(cookieNome, { path: cookiePath });
      res.status(204).end();
    },
  };
}

module.exports = {
  cliente: criarController('cliente', { login: authService.loginCliente, renovar: authService.renovarCliente }),
  admin: criarController('admin', { login: authService.loginAdmin, renovar: authService.renovarAdmin }),
};
