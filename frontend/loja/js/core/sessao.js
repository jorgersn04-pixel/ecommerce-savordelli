// Estado da sessao do cliente e preferencias do fluxo de compra.
import { sessaoToken, renovarSessao, entrar as apiEntrar, cadastrar as apiCadastrar, sairDaConta } from './api.js';

let usuario = null;

export const usuarioAtual = () => usuario;
export const logado = () => Boolean(sessaoToken.obter() && usuario);

function abrir(dados) {
  sessaoToken.definir(dados.access_token);
  usuario = dados.usuario;
  return usuario;
}

/** Tenta reabrir a sessao (cookie de refresh). Retorna o usuario ou null. Nao faz nada se nunca houve login. */
export async function restaurar() {
  if (!sessaoToken.talvezRestauravel()) return null;
  const dados = await renovarSessao();
  return dados ? abrir(dados) : null;
}

export async function entrar(email, senha) {
  return abrir(await apiEntrar(email, senha));
}

export async function cadastrar(dados) {
  return abrir(await apiCadastrar(dados));
}

export async function sair() {
  try {
    await sairDaConta();
  } catch {
    // mesmo sem rede, a sessao local e descartada
  }
  sessaoToken.limpar();
  usuario = null;
  sessionStorage.removeItem(CHAVE_CHECKOUT);
}

// ---------------------------------------------------------------- preferencias do checkout
const CHAVE_CHECKOUT = 'sv_checkout';

/** { cep, frete: { codigo, nome, valor, prazo_dias }, cupom, enderecoId } */
export function lerCheckout() {
  try {
    return JSON.parse(sessionStorage.getItem(CHAVE_CHECKOUT)) || {};
  } catch {
    return {};
  }
}

export function salvarCheckout(parcial) {
  const novo = { ...lerCheckout(), ...parcial };
  for (const k of Object.keys(novo)) if (novo[k] === undefined || novo[k] === null || novo[k] === '') delete novo[k];
  sessionStorage.setItem(CHAVE_CHECKOUT, JSON.stringify(novo));
  return novo;
}

export const limparCheckout = () => sessionStorage.removeItem(CHAVE_CHECKOUT);

/** Redireciona para a identificacao guardando o destino. */
export function irParaIdentificacao(destino = 'checkout.html') {
  window.location.assign(`identificacao.html?next=${encodeURIComponent(destino)}`);
}
