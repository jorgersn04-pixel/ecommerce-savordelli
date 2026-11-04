import { CONFIG } from '../config.js';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const moeda = (v) => BRL.format(Number(v));

/** Percentual de desconto inteiro, ou 0 se nao houver. */
export function percentualDesconto(cheio, atual) {
  const c = Number(cheio);
  const a = Number(atual);
  if (!(c > 0) || !(a >= 0) || a >= c) return 0;
  return Math.round((1 - a / c) * 100);
}

/** "ate 3x de R$ 9,97 sem juros" respeitando parcela minima e maximo de parcelas. Retorna '' se nao houver parcelamento. */
export function textoParcelamento(preco) {
  const p = Number(preco);
  const n = Math.min(CONFIG.PARCELAS_MAX, Math.floor(p / CONFIG.PARCELA_MINIMA));
  if (n < 2) return '';
  return `ou ${n}x de ${moeda(p / n)} sem juros`;
}

export function rotuloVariacao(v) {
  const a = typeof v.atributos === 'string' ? safeJson(v.atributos) : v.atributos;
  const txt = a && typeof a === 'object' ? Object.values(a).join(' / ') : '';
  return txt || v.sku;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function formatarCep(valor) {
  const d = String(valor).replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export const plural = (n, singular, pluralTxt) => (n === 1 ? singular : pluralTxt);
