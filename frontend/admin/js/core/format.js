const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUM = new Intl.NumberFormat('pt-BR');

export const moeda = (v) => BRL.format(Number(v ?? 0));
export const numero = (v) => NUM.format(Number(v ?? 0));

export function dataHora(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function dataCurta(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** ISO -> valor para <input type="datetime-local"> no fuso local. */
export function paraInputLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function deInputLocal(valor) {
  return valor ? new Date(valor).toISOString() : null;
}

/** [rotulo, variante do badge] */
export const STATUS_PEDIDO = {
  aguardando_pagamento: ['Aguardando pagamento', 'warn'],
  pago: ['Pago', 'ok'],
  em_separacao: ['Em separacao', 'info'],
  enviado: ['Enviado', 'info'],
  entregue: ['Entregue', 'ok'],
  cancelado: ['Cancelado', 'danger'],
  reembolsado: ['Reembolsado', 'danger'],
};

export const STATUS_PAGAMENTO = {
  pendente: ['Pendente', 'warn'],
  aprovado: ['Aprovado', 'ok'],
  recusado: ['Recusado', 'danger'],
  estornado: ['Estornado', 'danger'],
  expirado: ['Expirado', ''],
};

export const STATUS_PRODUTO = {
  rascunho: ['Rascunho', ''],
  ativo: ['Ativo', 'ok'],
  inativo: ['Inativo', 'danger'],
};

export const STATUS_FILA = {
  pendente: ['Pendente', 'warn'],
  processando: ['Processando', 'info'],
  sucesso: ['Sucesso', 'ok'],
  erro: ['Erro (nova tentativa)', 'warn'],
  morto: ['Falha definitiva', 'danger'],
};

export const METODO = { pix: 'PIX', cartao_credito: 'Cartao de credito', boleto: 'Boleto' };
export const TIPO_CUPOM = { percentual: 'Percentual', valor_fixo: 'Valor fixo', frete_gratis: 'Frete gratis' };
