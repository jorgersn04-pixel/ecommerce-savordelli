'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const { paraCentavos, deCentavos, precoEfetivo } = require('../utils/formatos');
const repo = require('../repositories/carrinho.repository');
const cupons = require('./cupom.service');
const frete = require('./frete.service');

const COOKIE = 'sv_carrinho';
const MAX_POR_ITEM = 99;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function definirCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 24 * 3600 * 1000,
  });
}

/**
 * Descobre (ou cria, se `criar`) o carrinho da requisicao.
 * Anonimo: cookie sv_carrinho. Logado (cliente): carrinho vinculado ao cliente; ao autenticar,
 * o carrinho anonimo e mesclado/vinculado.
 */
async function resolver(req, res, { criar = false } = {}) {
  const clienteId = req.usuario?.tipo === 'cliente' ? req.usuario.id : null;
  const tokenCookie = req.cookies?.[COOKIE];
  let anonimo = tokenCookie && UUID.test(tokenCookie) ? await repo.buscarAbertoPorToken(tokenCookie) : null;
  let carrinho = null;

  if (clienteId) {
    if (anonimo?.cliente_id && String(anonimo.cliente_id) !== String(clienteId)) anonimo = null;
    const doCliente = await repo.buscarAbertoDoCliente(clienteId);
    if (doCliente) {
      if (anonimo && String(anonimo.id) !== String(doCliente.id)) await repo.mesclar(anonimo.id, doCliente.id);
      carrinho = doCliente;
    } else if (anonimo) {
      await repo.vincularCliente(anonimo.id, clienteId);
      carrinho = { ...anonimo, cliente_id: clienteId };
    }
  } else if (anonimo && !anonimo.cliente_id) {
    carrinho = anonimo;
  }

  if (!carrinho && criar) carrinho = await repo.criar(crypto.randomUUID(), clienteId);
  if (carrinho && carrinho.token !== tokenCookie) definirCookie(res, carrinho.token);
  return carrinho;
}

/** Converte linhas do banco em itens de carrinho com precos atuais e problemas detectados. */
function montarItens(linhas) {
  return linhas.map((l) => {
    const unitario = precoEfetivo(l.preco, l.preco_promocional);
    const disponivel = Number(l.disponivel);
    let problema = null;
    if (l.status !== 'ativo' || l.excluido_em || !l.variacao_ativa) problema = 'INDISPONIVEL';
    else if (disponivel < l.quantidade) problema = disponivel === 0 ? 'SEM_ESTOQUE' : 'ESTOQUE_INSUFICIENTE';
    return {
      variacao_id: String(l.variacao_id),
      produto_id: String(l.produto_id),
      sku: l.sku,
      nome: l.nome,
      slug: l.slug,
      atributos: l.atributos,
      imagem: l.imagem,
      quantidade: l.quantidade,
      preco_unitario: unitario,
      preco_cheio: String(l.preco),
      total: deCentavos(paraCentavos(unitario) * l.quantidade),
      disponivel,
      problema,
      // dados internos para frete/checkout (removidos na resposta publica)
      _frete: {
        variacaoId: l.variacao_id, quantidade: l.quantidade, pesoG: l.peso_g,
        alturaCm: l.altura_cm, larguraCm: l.largura_cm, comprimentoCm: l.comprimento_cm,
        precoCent: paraCentavos(unitario),
      },
    };
  });
}

/** Subtotal, desconto de cupom e totais (sem frete). `cupomCodigo` invalido nao lanca: retorna o motivo. */
async function calcularResumo(itens, cupomCodigo, exec = pool) {
  const subtotalCent = itens.reduce((s, i) => s + paraCentavos(i.preco_unitario) * i.quantidade, 0);
  let cupom = null;
  let descontoCent = 0;
  let freteGratis = false;
  if (cupomCodigo) {
    try {
      const r = await cupons.validar(cupomCodigo, subtotalCent, { exec });
      descontoCent = r.descontoCent;
      freteGratis = r.freteGratis;
      cupom = { codigo: r.cupom.codigo, tipo: r.cupom.tipo, valido: true };
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      cupom = { codigo: String(cupomCodigo).trim(), valido: false, motivo: err.message };
    }
  }
  return {
    quantidade_itens: itens.reduce((s, i) => s + i.quantidade, 0),
    peso_total_g: itens.reduce((s, i) => s + i._frete.pesoG * i.quantidade, 0),
    subtotal: deCentavos(subtotalCent),
    desconto: deCentavos(descontoCent),
    total_produtos: deCentavos(subtotalCent - descontoCent),
    tem_problemas: itens.some((i) => i.problema),
    cupom,
    frete_gratis: freteGratis,
  };
}

const publico = (itens) => itens.map(({ _frete, ...i }) => i);

async function visualizar(req, res, cupomCodigo) {
  return visualizarCarrinho(await resolver(req, res), cupomCodigo);
}

async function visualizarCarrinho(carrinho, cupomCodigo) {
  if (!carrinho) {
    const vazio = await calcularResumo([], cupomCodigo);
    return { itens: [], cep_destino: null, ...vazio };
  }
  const itens = montarItens(await repo.itens(pool, carrinho.id));
  const resumo = await calcularResumo(itens, cupomCodigo);
  return { itens: publico(itens), cep_destino: carrinho.cep_destino, ...resumo };
}

async function validarAdicao(variacaoId, quantidadeFinal) {
  if (quantidadeFinal > MAX_POR_ITEM) {
    throw new AppError(422, 'QUANTIDADE_MAXIMA', `Máximo de ${MAX_POR_ITEM} unidades por item`);
  }
  const v = await repo.buscarVariacaoVendavel(variacaoId);
  if (!v) throw new AppError(404, 'VARIACAO_INDISPONIVEL', 'Produto indisponível');
  if (v.disponivel < quantidadeFinal) {
    throw new AppError(409, 'ESTOQUE_INSUFICIENTE', 'Estoque insuficiente', { disponivel: v.disponivel });
  }
}

async function adicionarItem(req, res, { variacao_id: variacaoId, quantidade }) {
  const carrinho = await resolver(req, res, { criar: true });
  const final = (await repo.quantidadeAtual(carrinho.id, variacaoId)) + quantidade;
  await validarAdicao(variacaoId, final);
  await repo.definirQuantidade(carrinho.id, variacaoId, final);
  return visualizarCarrinho(carrinho);
}

async function definirItem(req, res, variacaoId, quantidade) {
  const carrinho = await resolver(req, res);
  if (!carrinho) throw new AppError(404, 'ITEM_NAO_ENCONTRADO', 'Item não está no carrinho');
  if ((await repo.quantidadeAtual(carrinho.id, variacaoId)) === 0) {
    throw new AppError(404, 'ITEM_NAO_ENCONTRADO', 'Item não está no carrinho');
  }
  if (quantidade === 0) await repo.remover(carrinho.id, variacaoId);
  else {
    await validarAdicao(variacaoId, quantidade);
    await repo.definirQuantidade(carrinho.id, variacaoId, quantidade);
  }
  return visualizarCarrinho(carrinho);
}

async function removerItem(req, res, variacaoId) {
  const carrinho = await resolver(req, res);
  if (carrinho) await repo.remover(carrinho.id, variacaoId);
  return visualizarCarrinho(carrinho);
}

async function esvaziar(req, res) {
  const carrinho = await resolver(req, res);
  if (carrinho) await repo.limpar(carrinho.id);
  return visualizarCarrinho(carrinho);
}

/** Cota o frete do carrinho e memoriza o CEP. */
async function cotarFrete(req, res, { cep, cupom }) {
  const carrinho = await resolver(req, res);
  if (!carrinho) throw new AppError(422, 'CARRINHO_VAZIO', 'Carrinho vazio');
  const itens = montarItens(await repo.itens(pool, carrinho.id));
  if (itens.length === 0) throw new AppError(422, 'CARRINHO_VAZIO', 'Carrinho vazio');
  const resumo = await calcularResumo(itens, cupom);
  const opcoes = await frete.cotar({
    cepDestino: cep,
    itens: itens.map((i) => i._frete),
    freteGratis: resumo.frete_gratis,
  });
  await repo.definirCep(carrinho.id, cep);
  return { cep, opcoes };
}

/** Cotacao avulsa (pagina de produto): itens informados, sem carrinho. */
async function cotarAvulso({ cep, itens }) {
  const linhas = [];
  for (const it of itens) {
    const [rows] = await pool.query(
      `SELECT v.id AS variacao_id, ? AS quantidade, v.preco, v.preco_promocional, v.peso_g,
              v.altura_cm, v.largura_cm, v.comprimento_cm
         FROM produto_variacoes v JOIN produtos p ON p.id = v.produto_id
        WHERE v.id = ? AND v.ativo = 1 AND p.status = 'ativo' AND p.excluido_em IS NULL`,
      [it.quantidade, it.variacao_id],
    );
    if (!rows[0]) throw new AppError(404, 'VARIACAO_INDISPONIVEL', 'Produto indisponível');
    const r = rows[0];
    linhas.push({
      variacaoId: r.variacao_id, quantidade: it.quantidade, pesoG: r.peso_g, alturaCm: r.altura_cm,
      larguraCm: r.largura_cm, comprimentoCm: r.comprimento_cm,
      precoCent: paraCentavos(precoEfetivo(r.preco, r.preco_promocional)),
    });
  }
  return { cep, opcoes: await frete.cotar({ cepDestino: cep, itens: linhas }) };
}

module.exports = {
  resolver, montarItens, calcularResumo,
  visualizar, adicionarItem, definirItem, removerItem, esvaziar, cotarFrete, cotarAvulso,
};
