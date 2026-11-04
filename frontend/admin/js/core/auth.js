import { api, token, renovar } from './api.js';

let usuario = null;
let permissoes = [];

function decodificar(jwt) {
  try {
    const base = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base).split('').map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function definirSessao(dados) {
  const claims = decodificar(dados.access_token);
  token.definir(dados.access_token);
  usuario = dados.usuario;
  permissoes = Array.isArray(claims.perm) ? claims.perm : [];
}

/**
 * Apenas para exibir/ocultar itens de menu e botoes. A autorizacao real e feita pelo servidor
 * em toda requisicao; esta funcao espelha a regra de curingas do RBAC (`*`, `modulo.*`, exata).
 */
export function temPermissao(requerida) {
  if (!requerida) return true;
  return permissoes.some((p) => p === '*' || p === requerida || (p.endsWith('.*') && requerida.startsWith(p.slice(0, -1))));
}

export const usuarioAtual = () => usuario;

export async function entrar(email, senha) {
  const dados = await api('POST', '/auth/admin/login', { email, senha });
  definirSessao(dados);
  return dados.usuario;
}

/** Tenta reabrir a sessao a partir do cookie de refresh. Retorna o usuario ou null. */
export async function restaurar() {
  const dados = await renovar();
  if (!dados) return null;
  definirSessao(dados);
  return usuario;
}

export async function sair() {
  try {
    await api('POST', '/auth/admin/logout');
  } catch {
    // mesmo com falha de rede, a sessao local e descartada
  }
  token.definir(null);
  usuario = null;
  permissoes = [];
}
