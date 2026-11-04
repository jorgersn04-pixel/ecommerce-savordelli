'use strict';

const { z } = require('zod');
const { idSchema, dinheiro, paginacao } = require('./comum');

const dim = z.number().positive().max(200);

const variacaoBase = z.object({
  sku: z.string().trim().min(1).max(60),
  ean: z.string().regex(/^\d{8,14}$/, 'EAN invalido').nullish(),
  atributos: z.record(z.string(), z.union([z.string(), z.number()])).nullish(),
  preco: dinheiro,
  preco_promocional: dinheiro.nullish(),
  custo: dinheiro.nullish(),
  peso_g: z.number().int().positive().max(30000),
  altura_cm: dim,
  largura_cm: dim,
  comprimento_cm: dim,
  ativo: z.boolean().optional(),
});

const regraPromo = (v) =>
  v.preco_promocional == null || v.preco == null || Number(v.preco_promocional) < Number(v.preco);
const msgPromo = { message: 'preco_promocional deve ser menor que preco', path: ['preco_promocional'] };

const variacaoCriar = variacaoBase.refine(regraPromo, msgPromo);
const variacaoAtualizar = variacaoBase.partial().refine(regraPromo, msgPromo);

const imagem = z.object({
  url: z.string().url().max(500),
  texto_alternativo: z.string().max(200).nullish(),
  ordem: z.number().int().min(0).default(0),
  principal: z.boolean().default(false),
  variacao_id: idSchema.nullish(),
});

const produtoBase = z.object({
  marca_id: idSchema.nullish(),
  nome: z.string().trim().min(2).max(200),
  descricao_curta: z.string().max(500).nullish(),
  descricao: z.string().max(100000).nullish(),
  ncm: z.string().regex(/^\d{8}$/, 'NCM deve ter 8 digitos').nullish(),
  origem_fiscal: z.number().int().min(0).max(8).nullish(),
  status: z.enum(['rascunho', 'ativo', 'inativo']),
  categorias_ids: z.array(idSchema).max(30),
});

const produtoCriar = produtoBase.extend({
  status: produtoBase.shape.status.default('rascunho'),
  categorias_ids: produtoBase.shape.categorias_ids.default([]),
  variacoes: z.array(variacaoCriar).min(1).max(100),
  imagens: z.array(imagem).max(30).default([]),
});

const produtoAtualizar = produtoBase.partial();

const marcaSchema = z.object({
  nome: z.string().trim().min(2).max(100),
  ativo: z.boolean().optional(),
});

const categoriaSchema = z.object({
  nome: z.string().trim().min(2).max(100),
  pai_id: idSchema.nullish(),
  ordem: z.number().int().optional(),
  ativo: z.boolean().optional(),
  bling_categoria_id: idSchema.nullish(),
});

const estoqueSchema = z.object({ saldo: z.number().int().min(0).max(1_000_000) });

const listaAdmin = paginacao.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['rascunho', 'ativo', 'inativo']).optional(),
});

const listaPublica = paginacao.extend({
  q: z.string().trim().max(100).optional(),
  marca: z.string().max(120).optional(),
  categoria: z.string().max(120).optional(),
  ordem: z.enum(['recentes', 'preco_asc', 'preco_desc', 'nome']).default('recentes'),
});

module.exports = {
  variacaoCriar,
  variacaoAtualizar,
  imagem,
  produtoCriar,
  produtoAtualizar,
  marcaSchema,
  categoriaSchema,
  estoqueSchema,
  listaAdmin,
  listaPublica,
};
