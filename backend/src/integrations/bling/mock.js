'use strict';

const AppError = require('../../utils/AppError');

/** Bling simulado (dev/test sem credenciais). Mantem estado em memoria e permite injetar falhas. */
const estado = {
  seq: 1000,
  produtos: new Map(), // codigo -> { id, payload, situacao }
  saldos: new Map(), // produtoId -> saldo
  contatos: new Map(), // documento -> id
  pedidos: [],
  chamadas: [],
  falhas: [],
};

function reiniciar() {
  estado.seq = 1000;
  estado.produtos.clear();
  estado.saldos.clear();
  estado.contatos.clear();
  estado.pedidos.length = 0;
  estado.contatosAnonimizados = [];
  estado.chamadas.length = 0;
  estado.falhas.length = 0;
}

/** Proxima chamada falha. tipo: 'transitorio' | 'permanente'. */
function injetarFalha(tipo = 'transitorio', mensagem = 'falha simulada') {
  estado.falhas.push({ tipo, mensagem });
}

function entrar(nome, dados) {
  estado.chamadas.push({ nome, dados });
  const f = estado.falhas.shift();
  if (f) {
    const e = new AppError(f.tipo === 'permanente' ? 422 : 502, 'BLING_SIMULADO', f.mensagem);
    e[f.tipo === 'permanente' ? 'permanente' : 'transitorio'] = true;
    throw e;
  }
}

const novoId = () => String(++estado.seq);

async function buscarProdutoPorCodigo(codigo) {
  entrar('buscarProdutoPorCodigo', { codigo });
  return estado.produtos.get(codigo)?.id ?? null;
}
async function criarProduto(payload) {
  entrar('criarProduto', payload);
  const id = novoId();
  estado.produtos.set(payload.codigo, { id, payload, situacao: 'A' });
  return id;
}
async function atualizarProduto(id, payload) {
  entrar('atualizarProduto', { id, payload });
  const p = [...estado.produtos.values()].find((x) => x.id === String(id));
  if (p) p.payload = payload;
}
async function inativarProduto(id) {
  entrar('inativarProduto', { id });
  const p = [...estado.produtos.values()].find((x) => x.id === String(id));
  if (p) p.situacao = 'I';
}
async function lancarSaldo({ produtoId, quantidade }) {
  entrar('lancarSaldo', { produtoId, quantidade });
  estado.saldos.set(String(produtoId), quantidade);
}
async function saldos(ids) {
  entrar('saldos', { ids });
  const m = new Map();
  for (const id of ids) if (estado.saldos.has(String(id))) m.set(String(id), estado.saldos.get(String(id)));
  return m;
}
async function buscarContatoPorDocumento(doc) {
  entrar('buscarContatoPorDocumento', { doc });
  return estado.contatos.get(doc) ?? null;
}
async function criarContato(payload) {
  entrar('criarContato', payload);
  const id = novoId();
  estado.contatos.set(payload.numeroDocumento, id);
  return id;
}
async function anonimizarContato(id) {
  entrar('anonimizarContato', { id });
  for (const [doc, cid] of estado.contatos) if (cid === String(id)) estado.contatos.delete(doc);
  estado.contatosAnonimizados = [...(estado.contatosAnonimizados || []), String(id)];
}
async function criarPedidoVenda(payload) {
  entrar('criarPedidoVenda', payload);
  const id = novoId();
  estado.pedidos.push({ id, payload });
  return id;
}

module.exports = {
  simulado: true,
  estado, reiniciar, injetarFalha,
  buscarProdutoPorCodigo, criarProduto, atualizarProduto, inativarProduto,
  lancarSaldo, saldos,
  buscarContatoPorDocumento, criarContato, anonimizarContato, criarPedidoVenda,
};
