'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const logger = require('./config/logger');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url.startsWith('/health') } }));
app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {
      // Sem Origin (curl, server-to-server, webhooks) passa; navegador exige whitelist.
      if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  }),
);
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
// rawBody: necessario para validar a assinatura HMAC dos webhooks (Bling).
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(cookieParser());

app.use(routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
