'use strict';

const { z } = require('zod');
const { paginacao, idSchema } = require('./comum');

const TIPOS = ['acesso', 'correcao', 'exclusao', 'portabilidade', 'revogacao'];

const consentimentos = z
  .object({
    analytics: z.boolean().optional(),
    marketing: z.boolean().optional(),
    personalizacao: z.boolean().optional(),
  })
  .refine((c) => Object.keys(c).length > 0, 'informe ao menos uma finalidade');

const criarSolicitacao = z.object({
  tipo: z.enum(TIPOS),
  detalhes: z.string().trim().max(1000).optional(),
});

// Exige senha e uma confirmacao explicita: a acao e irreversivel.
const anonimizarProprio = z.object({
  senha: z.string().min(1).max(200),
  confirmacao: z.literal('EXCLUIR', { error: 'digite EXCLUIR para confirmar' }),
});

const listaAdmin = paginacao.extend({
  status: z.enum(['aberta', 'em_analise', 'concluida', 'negada']).optional(),
  tipo: z.enum(TIPOS).optional(),
});

const atualizarSolicitacao = z
  .object({
    status: z.enum(['em_analise', 'concluida', 'negada']),
    nota: z.string().trim().min(3).max(1000).optional(),
  })
  .refine((s) => s.status !== 'negada' || s.nota, { message: 'a negativa exige justificativa (nota)', path: ['nota'] });

const anonimizarAdmin = z.object({
  solicitacao_id: idSchema.optional(),
  motivo: z.string().trim().min(3).max(500),
});

module.exports = { consentimentos, criarSolicitacao, anonimizarProprio, listaAdmin, atualizarSolicitacao, anonimizarAdmin, TIPOS };
