'use strict';

const env = require('../../config/env');
const logger = require('../../config/logger');
const AppError = require('../../utils/AppError');
const { requisitar } = require('../http');

const BASE = {
  sandbox: 'https://sandbox.melhorenvio.com.br/api/v2',
  producao: 'https://melhorenvio.com.br/api/v2',
};

// Nomes dos servicos configurados em MELHOR_ENVIO_SERVICOS (ids do Melhor Envio).
const NOMES = { 1: 'PAC', 2: 'SEDEX' };
const nomeServico = (id) => NOMES[id] || `Servico ${id}`;

const simulado = !env.MELHOR_ENVIO_TOKEN;

function exigirConfiguracao() {
  if (!simulado) return;
  if (env.isProd) {
    throw new AppError(503, 'FRETE_INDISPONIVEL', 'Cotação de frete não configurada');
  }
}

/** Cotacao deterministica para desenvolvimento/testes (sem credenciais). */
function cotarSimulado({ cepDestino, produtos }) {
  const pesoKg = produtos.reduce((s, p) => s + p.weight * p.quantity, 0);
  const regiao = Number(cepDestino[0]); // 0-9: faixa postal (aprox. distancia de SP)
  const distancia = Math.abs(regiao - 0);
  return String(env.MELHOR_ENVIO_SERVICOS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => {
      const expresso = id === '2';
      const valor = (10 + pesoKg * 3 + distancia * 1.5) * (expresso ? 1.8 : 1);
      return {
        codigo: id,
        nome: nomeServico(id),
        valor: valor.toFixed(2),
        prazo_dias: Math.max(1, Math.round((expresso ? 2 : 5) + distancia * (expresso ? 0.3 : 0.7))),
      };
    });
}

/**
 * Cotacao no Melhor Envio (POST /me/shipment/calculate).
 * produtos: [{ id, width, height, length, weight(kg), insurance_value, quantity }]
 * Retorna [{ codigo, nome, valor:'12.34', prazo_dias }]; servicos com erro sao descartados.
 */
async function cotar({ cepOrigem, cepDestino, produtos }) {
  exigirConfiguracao();
  if (simulado) {
    logger.warn('Melhor Envio sem token: usando cotacao SIMULADA');
    return cotarSimulado({ cepDestino, produtos });
  }

  const contato = env.MELHOR_ENVIO_EMAIL_CONTATO || 'configure MELHOR_ENVIO_EMAIL_CONTATO';
  const r = await requisitar('melhorenvio', `${BASE[env.MELHOR_ENVIO_AMBIENTE]}/me/shipment/calculate`, {
    metodo: 'POST',
    headers: {
      Authorization: `Bearer ${env.MELHOR_ENVIO_TOKEN}`,
      'User-Agent': `Savordelli (${contato})`,
    },
    corpo: {
      from: { postal_code: cepOrigem },
      to: { postal_code: cepDestino },
      products: produtos,
      options: { receipt: false, own_hand: false },
      services: env.MELHOR_ENVIO_SERVICOS,
    },
  });

  if (r.status === 401 || r.status === 403) {
    logger.error({ status: r.status }, 'Melhor Envio: token rejeitado');
    throw new AppError(502, 'FRETE_INDISPONIVEL', 'Cotação de frete indisponível no momento');
  }
  if (r.status === 422) {
    throw new AppError(422, 'FRETE_DADOS_INVALIDOS', 'Não foi possível cotar o frete para este CEP/itens');
  }
  if (!r.ok || !Array.isArray(r.json)) {
    throw new AppError(502, 'FRETE_INDISPONIVEL', 'Cotação de frete indisponível no momento');
  }

  return r.json
    .filter((s) => !s.error && (s.custom_price ?? s.price) != null)
    .map((s) => ({
      codigo: String(s.id),
      nome: NOMES[s.id] || s.name,
      valor: Number(s.custom_price ?? s.price).toFixed(2),
      prazo_dias: Number(s.custom_delivery_time ?? s.delivery_time),
    }));
}

module.exports = { cotar, nomeServico, simulado };
