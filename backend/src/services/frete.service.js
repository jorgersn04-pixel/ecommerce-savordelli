'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const { deCentavos } = require('../utils/formatos');
const melhorEnvio = require('../integrations/melhorenvio/client');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function cepOrigem() {
  if (env.CEP_ORIGEM) return env.CEP_ORIGEM;
  if (melhorEnvio.simulado && !env.isProd) return '01001000';
  throw new AppError(503, 'FRETE_INDISPONIVEL', 'CEP de origem não configurado');
}

/**
 * itens: [{ variacaoId, quantidade, pesoG, alturaCm, larguraCm, comprimentoCm, precoCent }]
 * Cada unidade e enviada como produto (o Melhor Envio consolida o volume).
 */
function paraProdutosME(itens) {
  return itens.map((i) => ({
    id: String(i.variacaoId),
    width: Number(i.larguraCm),
    height: Number(i.alturaCm),
    length: Number(i.comprimentoCm),
    weight: Number((i.pesoG / 1000).toFixed(3)),
    insurance_value: Number((i.precoCent / 100).toFixed(2)),
    quantity: i.quantidade,
  }));
}

function chaveBase(origem, destino, produtos) {
  const norm = [...produtos]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => `${p.id}:${p.quantity}:${p.weight}:${p.width}x${p.height}x${p.length}:${p.insurance_value}`)
    .join('|');
  return `${origem}|${destino}|${norm}`;
}

async function lerCache(hashes) {
  if (hashes.length === 0) return [];
  const [rows] = await pool.query(
    'SELECT servico_codigo, valor, prazo_dias FROM frete_cotacoes_cache WHERE chave_hash IN (?) AND expira_em > UTC_TIMESTAMP()',
    [hashes],
  );
  return rows.map((r) => ({ codigo: r.servico_codigo, valor: r.valor, prazo_dias: r.prazo_dias }));
}

async function gravarCache(base, destino, opcoes) {
  const expira = new Date(Date.now() + env.FRETE_CACHE_HORAS * 3_600_000);
  for (const o of opcoes) {
    await pool.execute(
      `INSERT INTO frete_cotacoes_cache (chave_hash, cep_destino, servico_codigo, valor, prazo_dias, expira_em)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor), prazo_dias = VALUES(prazo_dias), expira_em = VALUES(expira_em)`,
      [sha(`${base}|${o.codigo}`), destino, o.codigo, o.valor, o.prazo_dias, expira],
    );
  }
}

/**
 * Cotacao com cache. Retorna opcoes ordenadas por preco: [{ codigo, nome, valor, prazo_dias, gratis }].
 * `freteGratis` zera a opcao mais barata (beneficio de cupom).
 */
async function cotar({ cepDestino, itens, freteGratis = false }) {
  if (itens.length === 0) throw new AppError(422, 'CARRINHO_VAZIO', 'Não há itens para cotar');
  const origem = cepOrigem();
  const produtos = paraProdutosME(itens);
  const base = chaveBase(origem, cepDestino, produtos);

  const servicos = env.MELHOR_ENVIO_SERVICOS.split(',').map((s) => s.trim()).filter(Boolean);
  let opcoes = await lerCache(servicos.map((s) => sha(`${base}|${s}`)));

  if (opcoes.length === 0) {
    opcoes = await melhorEnvio.cotar({ cepOrigem: origem, cepDestino, produtos });
    if (opcoes.length === 0) {
      throw new AppError(422, 'FRETE_SEM_OPCOES', 'Nenhuma opção de entrega disponível para este CEP');
    }
    await gravarCache(base, cepDestino, opcoes);
  }

  const lista = opcoes
    .map((o) => ({ ...o, nome: melhorEnvio.nomeServico(o.codigo) }))
    .sort((a, b) => Number(a.valor) - Number(b.valor) || a.prazo_dias - b.prazo_dias);

  return lista.map((o, idx) => {
    const gratis = freteGratis && idx === 0;
    return { codigo: o.codigo, nome: o.nome, valor: gratis ? deCentavos(0) : Number(o.valor).toFixed(2), prazo_dias: o.prazo_dias, gratis };
  });
}

/** Revalida no servidor o servico escolhido no checkout (nunca confiar no valor vindo do cliente). */
async function cotarServico({ cepDestino, itens, servico, freteGratis }) {
  const opcoes = await cotar({ cepDestino, itens, freteGratis });
  const escolhida = opcoes.find((o) => o.codigo === String(servico));
  if (!escolhida) throw new AppError(422, 'FRETE_SERVICO_INVALIDO', 'Serviço de entrega indisponível para este pedido');
  return escolhida;
}

module.exports = { cotar, cotarServico };
