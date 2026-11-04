'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default(''),

  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),
  DB_POOL_LIMIT: z.coerce.number().int().positive().default(10),

  // Usados a partir da Fase 1; exigidos desde ja para falhar cedo.
  JWT_ACCESS_SECRET: z.string().min(32, 'minimo de 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'hex de 64 caracteres (32 bytes)'),
  HMAC_KEY: z.string().min(32, 'minimo de 32 caracteres'),

  // Frete (Melhor Envio). Sem token em dev/test usa cotacao simulada; em producao e obrigatorio.
  CEP_ORIGEM: z.string().regex(/^\d{8}$/, '8 digitos').optional(),
  MELHOR_ENVIO_TOKEN: z.string().optional(),
  MELHOR_ENVIO_AMBIENTE: z.enum(['sandbox', 'producao']).default('sandbox'),
  MELHOR_ENVIO_EMAIL_CONTATO: z.string().default(''),
  MELHOR_ENVIO_SERVICOS: z.string().default('1,2'),
  FRETE_CACHE_HORAS: z.coerce.number().positive().default(6),

  // Pagamentos (Mercado Pago). Sem token em dev/test usa gateway simulado; em producao e obrigatorio.
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
  API_PUBLIC_URL: z.string().url().optional(),

  // Bling ERP v3 (OAuth2). Sem BLING_CLIENT_ID em dev/test usa um Bling simulado; em producao e obrigatorio.
  BLING_CLIENT_ID: z.string().optional(),
  BLING_CLIENT_SECRET: z.string().optional(),
  BLING_REDIRECT_URI: z.string().url().optional(),
  BLING_DEPOSITO_ID: z.string().regex(/^\d+$/).optional(),
  BLING_WORKER: z.enum(['on', 'off']).default('on'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const detalhes = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Configuracao de ambiente invalida:\n${detalhes}\nVerifique o arquivo backend/.env`);
  process.exit(1);
}

const env = parsed.data;
env.isProd = env.NODE_ENV === 'production';
env.corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);

module.exports = Object.freeze(env);
