'use strict';

/**
 * Helpers dos testes de integracao (MySQL real). So executam com SV_TEST_DB=1, apontando
 * para um banco DESCARTAVEL: as tabelas de negocio sao truncadas a cada suite.
 *   SV_TEST_DB=1 DB_PORT=3390 DB_USER=root DB_PASSWORD=testpw DB_NAME=sv_test npm test
 */
const habilitado = process.env.SV_TEST_DB === '1';

if (habilitado) {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(40);
  process.env.ENCRYPTION_KEY ??= '1'.repeat(64);
  process.env.HMAC_KEY ??= 'b'.repeat(40);
  process.env.DB_USER ??= 'root';
  process.env.DB_NAME ??= 'sv_test';
}

const TABELAS = [
  'logs_auditoria', 'bling_sync_fila', 'bling_sync_logs', 'consentimentos_registro', 'solicitacoes_titular',
  'notas_fiscais', 'envios', 'pagamentos', 'pedido_historico_status', 'pedido_itens', 'pedidos',
  'carrinho_itens', 'carrinhos', 'cupons', 'frete_cotacoes_cache', 'estoque_movimentacoes',
  'produto_imagens', 'produto_categorias', 'produto_variacoes', 'produtos', 'categorias', 'marcas',
  'sessoes_refresh', 'enderecos', 'clientes', 'admin_usuarios',
];

async function iniciar() {
  const app = require('../src/app');
  const { pool } = require('../src/config/db');
  const { hashSenha } = require('../src/utils/password');

  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of TABELAS) await pool.query(`TRUNCATE TABLE ${t}`);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(metodo, caminho, { body, token, cookie, headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (token) h.authorization = `Bearer ${token}`;
    if (cookie) h.cookie = cookie;
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: h,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const texto = await r.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = texto;
    }
    return { status: r.status, body: json, headers: r.headers };
  }

  async function criarAdmin(email, papel = 'admin') {
    const [[p]] = await pool.execute('SELECT id FROM papeis WHERE nome = ?', [papel]);
    await pool.execute('INSERT INTO admin_usuarios (papel_id, nome, email, senha_hash) VALUES (?, ?, ?, ?)', [
      p.id, `Admin ${papel}`, email, await hashSenha('Senha@12345'),
    ]);
    const r = await api('POST', '/auth/admin/login', { body: { email, senha: 'Senha@12345' } });
    return r.body.access_token;
  }

  async function encerrar() {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await pool.end();
  }

  return { api, pool, criarAdmin, encerrar };
}

module.exports = { habilitado, iniciar };
