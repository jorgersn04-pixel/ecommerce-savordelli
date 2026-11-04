'use strict';

const env = require('../../config/env');
const logger = require('../../config/logger');
const AppError = require('../../utils/AppError');
const { requisitar } = require('../http');
const auth = require('./auth');

const BASE = 'https://api.bling.com.br/Api/v3';
const INTERVALO_MIN_MS = 350; // limite do Bling: 3 req/s

let ultima = 0;
async function respeitarLimite() {
  const espera = ultima + INTERVALO_MIN_MS - Date.now();
  ultima = Math.max(Date.now(), ultima) + (espera > 0 ? INTERVALO_MIN_MS : 0);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
}

function querystring(query = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(`${k}[]`, x));
    else if (v !== undefined && v !== null) q.append(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

function mensagemDeErro(json) {
  const e = json?.error;
  if (!e) return 'erro desconhecido';
  const campos = (e.fields || []).map((f) => f.msg || f.element).filter(Boolean).join('; ');
  return [e.description || e.message || e.type, campos].filter(Boolean).join(' - ').slice(0, 400);
}

/** Chamada autenticada. Renova o token uma vez em 401. Classifica erros em transitorios/permanentes. */
async function chamar(metodo, caminho, { query, corpo } = {}) {
  const executar = async (token) => {
    await respeitarLimite();
    return requisitar('bling', `${BASE}${caminho}${querystring(query)}`, {
      metodo, headers: { Authorization: `Bearer ${token}` }, corpo, timeoutMs: 20_000,
    });
  };

  let r = await executar(await auth.obterAccessToken());
  if (r.status === 401) r = await executar(await auth.renovar());

  if (r.ok) return r.json;
  const msg = mensagemDeErro(r.json);
  if (r.status === 429) {
    const e = new AppError(429, 'BLING_LIMITE', 'Limite de requisicoes do Bling atingido');
    e.transitorio = true;
    throw e;
  }
  if (r.status >= 500 || r.status === 401) {
    const e = new AppError(502, 'BLING_INDISPONIVEL', `Bling indisponivel (${r.status})`);
    e.transitorio = true;
    throw e;
  }
  logger.warn({ metodo, caminho, status: r.status, msg }, 'Bling rejeitou a requisicao');
  const e = new AppError(422, 'BLING_REJEITOU', `Bling rejeitou (${r.status}): ${msg}`);
  e.permanente = true;
  throw e;
}

// --------------------------------------------------------------- produtos
async function buscarProdutoPorCodigo(codigo) {
  const j = await chamar('GET', '/produtos', { query: { codigo, limite: 1 } });
  return j?.data?.[0]?.id ? String(j.data[0].id) : null;
}
async function criarProduto(payload) {
  return String((await chamar('POST', '/produtos', { corpo: payload })).data.id);
}
async function atualizarProduto(id, payload) {
  await chamar('PUT', `/produtos/${id}`, { corpo: payload });
}
async function inativarProduto(id) {
  await chamar('PATCH', `/produtos/${id}/situacoes`, { corpo: { situacao: 'I' } });
}

// ---------------------------------------------------------------- estoque
async function lancarSaldo({ produtoId, quantidade, observacao }) {
  if (!env.BLING_DEPOSITO_ID) {
    const e = new AppError(422, 'BLING_SEM_DEPOSITO', 'BLING_DEPOSITO_ID nao configurado');
    e.permanente = true;
    throw e;
  }
  await chamar('POST', '/estoques', {
    corpo: {
      deposito: { id: Number(env.BLING_DEPOSITO_ID) },
      produto: { id: Number(produtoId) },
      operacao: 'B', // balanco: define o saldo absoluto
      quantidade,
      observacoes: observacao || 'Ajuste pela loja',
    },
  });
}

/** Retorna Map(produtoId -> saldo vendavel). Usa o deposito configurado ou o saldo virtual total. */
async function saldos(idsProdutos) {
  const mapa = new Map();
  for (let i = 0; i < idsProdutos.length; i += 100) {
    const lote = idsProdutos.slice(i, i + 100);
    const j = await chamar('GET', '/estoques/saldos', {
      query: { idsProdutos: lote, ...(env.BLING_DEPOSITO_ID ? { idsDepositos: [env.BLING_DEPOSITO_ID] } : {}) },
    });
    for (const s of j?.data || []) {
      const dep = env.BLING_DEPOSITO_ID && (s.depositos || []).find((d) => String(d.id) === env.BLING_DEPOSITO_ID);
      const saldo = dep ? dep.saldoVirtual : s.saldoVirtualTotal;
      mapa.set(String(s.produto.id), Math.max(0, Math.trunc(Number(saldo) || 0)));
    }
  }
  return mapa;
}

// ---------------------------------------------------- contatos e pedidos
async function buscarContatoPorDocumento(documento) {
  const j = await chamar('GET', '/contatos', { query: { numeroDocumento: documento, limite: 1 } });
  return j?.data?.[0]?.id ? String(j.data[0].id) : null;
}
async function criarContato(payload) {
  return String((await chamar('POST', '/contatos', { corpo: payload })).data.id);
}
async function criarPedidoVenda(payload) {
  return String((await chamar('POST', '/pedidos/vendas', { corpo: payload })).data.id);
}

module.exports = {
  simulado: false,
  buscarProdutoPorCodigo, criarProduto, atualizarProduto, inativarProduto,
  lancarSaldo, saldos,
  buscarContatoPorDocumento, criarContato, criarPedidoVenda,
};
