'use strict';

const AppError = require('../utils/AppError');
const { verificarSenha, verificarSenhaFalsa } = require('../utils/password');
const usuarios = require('../repositories/usuarios.repository');
const tokens = require('./token.service');

const credenciaisInvalidas = () => new AppError(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha incorretos');

function respostaCliente(c, access, refresh) {
  return {
    usuario: { id: String(c.id), nome: c.nome, email: c.email, tipo: 'cliente' },
    access_token: access,
    refresh,
  };
}

function respostaAdmin(a, access, refresh) {
  return {
    usuario: { id: String(a.id), nome: a.nome, email: a.email, tipo: 'admin', papel: a.papel },
    access_token: access,
    refresh,
  };
}

const accessCliente = (c) => tokens.gerarAccessToken({ id: c.id, tipo: 'cliente' });
const accessAdmin = (a) =>
  tokens.gerarAccessToken({ id: a.id, tipo: 'admin', papel: a.papel, permissoes: a.permissoes });

// ---------------------------------------------------------------- cliente
async function loginCliente({ email, senha }, ctx) {
  const cliente = await usuarios.buscarClientePorEmail(email);
  if (!cliente) {
    await verificarSenhaFalsa(senha);
    throw credenciaisInvalidas();
  }
  if (!(await verificarSenha(cliente.senha_hash, senha)) || cliente.anonimizado_em) throw credenciaisInvalidas();

  const refresh = await tokens.criarRefreshToken({ tipo: 'cliente', usuarioId: cliente.id, ...ctx });
  return respostaCliente(cliente, accessCliente(cliente), refresh);
}

async function renovarCliente(refreshToken, ctx) {
  const { usuarioId, refresh } = await tokens.rotacionarRefreshToken({ tipo: 'cliente', token: refreshToken, ...ctx });
  const cliente = await usuarios.buscarClientePorId(usuarioId);
  if (!cliente || cliente.anonimizado_em) {
    await tokens.revogarRefreshToken({ tipo: 'cliente', token: refresh.token });
    throw new AppError(401, 'REFRESH_INVALIDO', 'Sessao invalida ou expirada');
  }
  return respostaCliente(cliente, accessCliente(cliente), refresh);
}

// ------------------------------------------------------------------ admin
async function loginAdmin({ email, senha }, ctx) {
  const admin = await usuarios.buscarAdminPorEmail(email);
  if (!admin) {
    await verificarSenhaFalsa(senha);
    throw credenciaisInvalidas();
  }
  if (!(await verificarSenha(admin.senha_hash, senha)) || !admin.ativo) throw credenciaisInvalidas();

  await usuarios.registrarLoginAdmin(admin.id);
  const refresh = await tokens.criarRefreshToken({ tipo: 'admin', usuarioId: admin.id, ...ctx });
  return respostaAdmin(admin, accessAdmin(admin), refresh);
}

async function renovarAdmin(refreshToken, ctx) {
  const { usuarioId, refresh } = await tokens.rotacionarRefreshToken({ tipo: 'admin', token: refreshToken, ...ctx });
  // Papel e permissoes sao relidos do banco a cada renovacao.
  const admin = await usuarios.buscarAdminPorId(usuarioId);
  if (!admin || !admin.ativo) {
    await tokens.revogarRefreshToken({ tipo: 'admin', token: refresh.token });
    throw new AppError(401, 'REFRESH_INVALIDO', 'Sessao invalida ou expirada');
  }
  return respostaAdmin(admin, accessAdmin(admin), refresh);
}

module.exports = { loginCliente, renovarCliente, loginAdmin, renovarAdmin };
