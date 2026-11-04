'use strict';

const { z } = require('zod');

/** ID numerico mantido como string (BIGINT). */
const idSchema = z.string().regex(/^\d{1,18}$/, 'id invalido');
const idParams = z.object({ id: idSchema });

/** Dinheiro: aceita 19.9 ou "19.90" (max 2 casas) e normaliza para string "19.90". */
const dinheiro = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'valor monetario invalido'))
  .transform((v) => Number(v).toFixed(2));

const paginacao = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(60).default(20),
});

const cep = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(z.string().length(8, 'CEP deve ter 8 digitos'));

module.exports = { idSchema, idParams, dinheiro, paginacao, cep };
