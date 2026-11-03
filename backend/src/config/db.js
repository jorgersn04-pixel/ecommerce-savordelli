'use strict';

const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_POOL_LIMIT,
  waitForConnections: true,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z', // datas em UTC
  decimalNumbers: false, // DECIMAL como string: evita erro de ponto flutuante em dinheiro
  supportBigNumbers: true,
  bigNumberStrings: true,
  namedPlaceholders: true,
  enableKeepAlive: true,
});

/** Executa fn(conn) dentro de uma transacao; commit em sucesso, rollback em erro. */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Verifica conectividade com o banco. */
async function ping() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

module.exports = { pool, withTransaction, ping };
