'use strict';

const env = require('./config/env');
const logger = require('./config/logger');
const { pool, ping } = require('./config/db');
const app = require('./app');

async function main() {
  try {
    await ping();
    logger.info('MySQL conectado');
  } catch (err) {
    // Nao derruba o servidor: /health responde e /health/db reporta o problema.
    logger.error({ err }, 'MySQL indisponivel na inicializacao');
  }

  require('./jobs/expirarPedidos').iniciar();
  require('./jobs/blingWorker').iniciar();

  const server = app.listen(env.PORT, () => {
    logger.info(`API Savordelli em http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const encerrar = (sinal) => {
    logger.info(`${sinal} recebido, encerrando`);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
main();
