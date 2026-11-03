'use strict';

process.env.DB_USER ??= 'test';
process.env.DB_NAME ??= 'test';
process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(40);
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.HMAC_KEY ??= 'b'.repeat(40);

const test = require('node:test');
const assert = require('node:assert/strict');
const { temPermissao, exigirPermissao } = require('../src/middlewares/rbac');
const { gerarAccessToken, verificarAccessToken } = require('../src/services/token.service');
const { autenticar } = require('../src/middlewares/auth');
const { ipParaBuffer } = require('../src/utils/ip');

test('curingas de permissao', () => {
  assert.ok(temPermissao(['*'], 'qualquer.coisa'));
  assert.ok(temPermissao(['produtos.*'], 'produtos.ler'));
  assert.ok(temPermissao(['produtos.*'], 'produtos.estoque.ajustar'));
  assert.ok(temPermissao(['pedidos.ler'], 'pedidos.ler'));
  assert.ok(!temPermissao(['pedidos.ler'], 'pedidos.cancelar'));
  assert.ok(!temPermissao(['produtos.*'], 'produtosx.ler'));
  assert.ok(!temPermissao(['produtos.*'], 'produtos'));
  assert.ok(!temPermissao([], 'produtos.ler'));
  assert.ok(!temPermissao(undefined, 'produtos.ler'));
});

test('exigirPermissao responde 403 sem permissao e segue com permissao', () => {
  const chamar = (permissoes) => {
    let erro = 'nenhum';
    exigirPermissao('notas.ler')({ usuario: { permissoes } }, null, (e) => (erro = e));
    return erro;
  };
  assert.equal(chamar(['produtos.*']).status, 403);
  assert.equal(chamar(['notas.*']), undefined);
});

test('JWT: gera, valida e rejeita adulterado/expirado', () => {
  const t = gerarAccessToken({ id: 7, tipo: 'admin', papel: 'operador', permissoes: ['produtos.*'] });
  const u = verificarAccessToken(t);
  assert.deepEqual(u, { id: '7', tipo: 'admin', papel: 'operador', permissoes: ['produtos.*'] });
  assert.equal(((() => { try { verificarAccessToken(t + 'x'); } catch (e) { return e; } })()).codigo, 'TOKEN_INVALIDO');

  const jwt = require('jsonwebtoken');
  const expirado = jwt.sign({ tipo: 'admin' }, process.env.JWT_ACCESS_SECRET, { issuer: 'savordelli', subject: '1', expiresIn: -10 });
  assert.equal(((() => { try { verificarAccessToken(expirado); } catch (e) { return e; } })()).codigo, 'TOKEN_EXPIRADO');
});

test('autenticar: sem token 401, tipo errado 403, ok popula req.usuario', () => {
  const rodar = (headers, tipo) => {
    const req = { headers };
    let erro = 'nenhum';
    autenticar(tipo)(req, null, (e) => (erro = e));
    return { erro, req };
  };
  assert.equal(rodar({}, 'admin').erro.codigo, 'TOKEN_AUSENTE');
  const cliente = gerarAccessToken({ id: 1, tipo: 'cliente' });
  assert.equal(rodar({ authorization: `Bearer ${cliente}` }, 'admin').erro.status, 403);
  const ok = rodar({ authorization: `Bearer ${cliente}` }, 'cliente');
  assert.equal(ok.erro, undefined);
  assert.equal(ok.req.usuario.id, '1');
});

test('ipParaBuffer', () => {
  assert.deepEqual([...ipParaBuffer('192.168.0.1')], [192, 168, 0, 1]);
  assert.deepEqual([...ipParaBuffer('::ffff:10.0.0.2')], [10, 0, 0, 2]);
  assert.equal(ipParaBuffer('::1').length, 16);
  assert.equal(ipParaBuffer('::1')[15], 1);
  assert.equal(ipParaBuffer(undefined), null);
});
