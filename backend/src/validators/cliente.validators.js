'use strict';

const { z } = require('zod');
const { cep } = require('./comum');
const { cpfValido, apenasDigitos } = require('../utils/formatos');

const senha = z
  .string()
  .min(8, 'minimo de 8 caracteres')
  .max(128)
  .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), 'a senha deve conter letras e numeros');

const telefone = z
  .string()
  .transform(apenasDigitos)
  .pipe(z.string().regex(/^\d{10,11}$/, 'telefone invalido (DDD + numero)'));

const dataNascimento = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
  .refine((d) => {
    const dt = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(dt.getTime()) && dt < new Date() && dt.getUTCFullYear() > 1900;
  }, 'data invalida');

const registrar = z.object({
  nome: z.string().trim().min(3).max(150),
  email: z.string().trim().toLowerCase().email().max(190),
  senha,
  cpf: z.string().refine(cpfValido, 'CPF invalido').transform(apenasDigitos),
  telefone: telefone.optional(),
  data_nascimento: dataNascimento.optional(),
  aceite_termos: z.literal(true, { error: 'e necessario aceitar os termos e a politica de privacidade' }),
  consentimentos: z
    .object({
      analytics: z.boolean().default(false),
      marketing: z.boolean().default(false),
      personalizacao: z.boolean().default(false),
    })
    .default({ analytics: false, marketing: false, personalizacao: false }),
});

const atualizarPerfil = z.object({
  nome: z.string().trim().min(3).max(150).optional(),
  telefone: telefone.nullish(),
  data_nascimento: dataNascimento.nullish(),
});

const endereco = z.object({
  apelido: z.string().trim().max(50).nullish(),
  destinatario: z.string().trim().min(3).max(150),
  cep,
  logradouro: z.string().trim().min(2).max(190),
  numero: z.string().trim().min(1).max(20),
  complemento: z.string().trim().max(100).nullish(),
  bairro: z.string().trim().min(2).max(100),
  cidade: z.string().trim().min(2).max(100),
  uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF invalida'),
  padrao: z.boolean().default(false),
});

module.exports = { registrar, atualizarPerfil, endereco };
