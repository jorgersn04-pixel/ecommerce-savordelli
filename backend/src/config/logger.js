'use strict';

const pino = require('pino');
const env = require('./env');

const logger = pino({
  level: env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  transport: env.isProd ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});

module.exports = logger;
