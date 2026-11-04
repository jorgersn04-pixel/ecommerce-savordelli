'use strict';

const { z } = require('zod');
const { idSchema, cep } = require('./comum');

const cupomOpcional = z.string().trim().min(1).max(40).optional();

const adicionarItem = z.object({
  variacao_id: idSchema,
  quantidade: z.number().int().min(1).max(99),
});

const definirItem = z.object({ quantidade: z.number().int().min(0).max(99) });

const variacaoParams = z.object({ variacaoId: idSchema });

const verCarrinho = z.object({ cupom: cupomOpcional });

const cotarCarrinho = z.object({ cep, cupom: cupomOpcional });

const cotarAvulso = z.object({
  cep,
  itens: z.array(z.object({ variacao_id: idSchema, quantidade: z.number().int().min(1).max(99) })).min(1).max(20),
});

const cupomAdmin = z.object({
  codigo: z.string().trim().min(3).max(40).transform((v) => v.toUpperCase()),
  tipo: z.enum(['percentual', 'valor_fixo', 'frete_gratis']),
  valor: z.number().min(0).max(100000).default(0),
  pedido_minimo: z.number().min(0).nullish(),
  limite_usos: z.number().int().positive().nullish(),
  valido_de: z.coerce.date().nullish(),
  valido_ate: z.coerce.date().nullish(),
  ativo: z.boolean().default(true),
}).refine((c) => c.tipo !== 'percentual' || (c.valor > 0 && c.valor <= 100), {
  message: 'percentual deve estar entre 0 e 100', path: ['valor'],
}).refine((c) => c.tipo !== 'valor_fixo' || c.valor > 0, {
  message: 'valor_fixo deve ser maior que zero', path: ['valor'],
});

module.exports = { adicionarItem, definirItem, variacaoParams, verCarrinho, cotarCarrinho, cotarAvulso, cupomAdmin };
