'use strict';

const { z } = require('zod');
const { idSchema, paginacao } = require('./comum');

const pagamento = z.discriminatedUnion('metodo', [
  z.object({ metodo: z.literal('pix') }),
  z.object({ metodo: z.literal('boleto') }),
  z.object({
    metodo: z.literal('cartao_credito'),
    token: z.string().min(5).max(200), // token do cartao gerado no navegador (SDK do Mercado Pago)
    payment_method_id: z.string().min(2).max(40), // bandeira: visa, master...
    parcelas: z.number().int().min(1).max(12).default(1),
    issuer_id: z.string().max(20).nullish(),
  }),
]);

const checkout = z.object({
  endereco_id: idSchema,
  frete_servico: z.string().trim().min(1).max(20),
  cupom: z.string().trim().min(1).max(40).optional(),
  pagamento,
});

const pagar = z.object({ pagamento });

const numeroParams = z.object({ numero: z.string().regex(/^SV-\d{4}-\d{6,}$/, 'numero de pedido invalido') });

const listaCliente = paginacao;

const STATUS = ['aguardando_pagamento', 'pago', 'em_separacao', 'enviado', 'entregue', 'cancelado', 'reembolsado'];

const listaAdmin = paginacao.extend({
  status: z.enum(STATUS).optional(),
  q: z.string().trim().max(100).optional(),
});

const atualizarStatus = z.object({
  status: z.enum(STATUS),
  observacao: z.string().trim().max(500).optional(),
  codigo_rastreio: z.string().trim().max(20).optional(),
});

module.exports = { checkout, pagar, numeroParams, listaCliente, listaAdmin, atualizarStatus };
