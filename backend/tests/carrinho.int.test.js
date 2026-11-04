'use strict';

const { habilitado, iniciar } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const cookieDe = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('carrinho, cupom e frete (integracao)', { skip: !habilitado && 'defina SV_TEST_DB=1' }, async (t) => {
  const ctx = await iniciar();
  const { api, criarAdmin, pool } = ctx;
  t.after(() => ctx.encerrar());

  const admin = await criarAdmin('admin@t.com', 'admin');
  const operador = await criarAdmin('op@t.com', 'operador');

  const prod = await api('POST', '/admin/produtos', {
    token: operador,
    body: {
      nome: 'Hidratante', status: 'ativo',
      variacoes: [
        { sku: 'H-1', preco: '50.00', peso_g: 400, altura_cm: 10, largura_cm: 10, comprimento_cm: 10 },
        { sku: 'H-2', preco: '80.00', preco_promocional: '60.00', peso_g: 600, altura_cm: 12, largura_cm: 10, comprimento_cm: 10 },
      ],
    },
  });
  assert.equal(prod.status, 201);
  const [v1, v2] = prod.body.variacoes;
  await api('PUT', `/admin/variacoes/${v1.id}/estoque`, { token: operador, body: { saldo: 5 } });
  await api('PUT', `/admin/variacoes/${v2.id}/estoque`, { token: operador, body: { saldo: 2 } });

  let cookie;

  await t.test('carrinho vazio e adicao anonima define cookie', async () => {
    const vazio = await api('GET', '/carrinho');
    assert.equal(vazio.status, 200);
    assert.equal(vazio.body.itens.length, 0);

    const r = await api('POST', '/carrinho/itens', { body: { variacao_id: v1.id, quantidade: 2 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    cookie = cookieDe(r);
    assert.match(cookie, /sv_carrinho=/);
    assert.equal(r.body.subtotal, '100.00');
    assert.equal(r.body.peso_total_g, 800);
    assert.ok(!('_frete' in r.body.itens[0]));
  });

  await t.test('preco promocional, soma e limite de estoque', async () => {
    let r = await api('POST', '/carrinho/itens', { cookie, body: { variacao_id: v2.id, quantidade: 1 } });
    assert.equal(r.status, 201);
    assert.equal(r.body.subtotal, '160.00'); // 2x50 + 60
    r = await api('POST', '/carrinho/itens', { cookie, body: { variacao_id: v2.id, quantidade: 2 } });
    assert.equal(r.status, 409);
    assert.equal(r.body.erro.codigo, 'ESTOQUE_INSUFICIENTE');
    assert.equal(r.body.erro.detalhes.disponivel, 2);
    assert.equal((await api('POST', '/carrinho/itens', { cookie, body: { variacao_id: '999999', quantidade: 1 } })).status, 404);
    assert.equal((await api('POST', '/carrinho/itens', { cookie, body: { variacao_id: v1.id, quantidade: 0 } })).status, 400);
  });

  await t.test('alterar e remover itens', async () => {
    let r = await api('PUT', `/carrinho/itens/${v1.id}`, { cookie, body: { quantidade: 1 } });
    assert.equal(r.body.subtotal, '110.00');
    r = await api('PUT', `/carrinho/itens/${v2.id}`, { cookie, body: { quantidade: 0 } });
    assert.equal(r.body.itens.length, 1);
    assert.equal((await api('PUT', `/carrinho/itens/${v2.id}`, { cookie, body: { quantidade: 1 } })).status, 404);
    await api('PUT', `/carrinho/itens/${v1.id}`, { cookie, body: { quantidade: 2 } });
  });

  await t.test('cupons: percentual, minimo, invalido', async () => {
    const mk = (b) => api('POST', '/admin/cupons', { token: admin, body: b });
    assert.equal((await mk({ codigo: 'dez', tipo: 'percentual', valor: 10 })).status, 201);
    assert.equal((await mk({ codigo: 'MIN500', tipo: 'valor_fixo', valor: 20, pedido_minimo: 500 })).status, 201);
    assert.equal((await mk({ codigo: 'FRETE', tipo: 'frete_gratis' })).status, 201);
    assert.equal((await mk({ codigo: 'RUIM', tipo: 'percentual', valor: 150 })).status, 400);
    assert.equal((await api('POST', '/admin/cupons', { token: operador, body: { codigo: 'XXX', tipo: 'frete_gratis' } })).status, 403);

    let r = await api('GET', '/carrinho?cupom=DEZ', { cookie });
    assert.equal(r.body.cupom.valido, true);
    assert.equal(r.body.desconto, '10.00');
    assert.equal(r.body.total_produtos, '90.00');
    r = await api('GET', '/carrinho?cupom=min500', { cookie });
    assert.equal(r.body.cupom.valido, false);
    assert.match(r.body.cupom.motivo, /m[ií]nimo/i);
    r = await api('GET', '/carrinho?cupom=NAOEXISTE', { cookie });
    assert.equal(r.body.cupom.valido, false);
    assert.equal(r.body.desconto, '0.00');
  });

  await t.test('frete: cotacao, cache e frete gratis na opcao mais barata', async () => {
    let r = await api('POST', '/carrinho/frete', { cookie, body: { cep: '01310-100' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.cep, '01310100');
    assert.equal(r.body.opcoes.length, 2);
    assert.deepEqual(r.body.opcoes.map((o) => o.nome).sort(), ['PAC', 'SEDEX']);
    assert.ok(Number(r.body.opcoes[0].valor) <= Number(r.body.opcoes[1].valor));
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM frete_cotacoes_cache');
    assert.equal(Number(n), 2);

    const r2 = await api('POST', '/carrinho/frete', { cookie, body: { cep: '01310100' } });
    assert.deepEqual(r2.body.opcoes, r.body.opcoes); // servido do cache

    r = await api('POST', '/carrinho/frete', { cookie, body: { cep: '01310100', cupom: 'FRETE' } });
    assert.equal(r.body.opcoes[0].valor, '0.00');
    assert.equal(r.body.opcoes[0].gratis, true);
    assert.notEqual(r.body.opcoes[1].valor, '0.00');

    assert.equal((await api('POST', '/carrinho/frete', { cookie, body: { cep: '123' } })).status, 400);
    const cart = await api('GET', '/carrinho', { cookie });
    assert.equal(cart.body.cep_destino, '01310100');
  });

  await t.test('cotacao avulsa pela pagina de produto', async () => {
    const r = await api('POST', '/frete/cotar', { body: { cep: '20040020', itens: [{ variacao_id: v1.id, quantidade: 1 }] } });
    assert.equal(r.status, 200);
    assert.ok(r.body.opcoes.length > 0);
  });

  await t.test('login mescla o carrinho anonimo com o do cliente', async () => {
    const { hashSenha } = require('../src/utils/password');
    await pool.execute('INSERT INTO clientes (nome, email, senha_hash) VALUES (?, ?, ?)', [
      'Maria', 'maria@t.com', await hashSenha('Senha@12345'),
    ]);
    const login = await api('POST', '/auth/cliente/login', { body: { email: 'maria@t.com', senha: 'Senha@12345' } });
    const token = login.body.access_token;

    // 1a vez: carrinho anonimo e vinculado ao cliente
    let r = await api('GET', '/carrinho', { cookie, token });
    assert.equal(r.body.itens.length, 1);
    assert.equal(r.body.itens[0].quantidade, 2);

    // visitante sem login nao enxerga mais o carrinho vinculado
    r = await api('GET', '/carrinho', { cookie });
    assert.equal(r.body.itens.length, 0);

    // novo carrinho anonimo + login: mescla (soma) no carrinho do cliente
    r = await api('POST', '/carrinho/itens', { body: { variacao_id: v1.id, quantidade: 1 } });
    const cookie2 = cookieDe(r);
    r = await api('GET', '/carrinho', { cookie: cookie2, token });
    assert.equal(r.body.itens.length, 1);
    assert.equal(r.body.itens[0].quantidade, 3);

    // token de admin e ignorado pela loja
    r = await api('GET', '/carrinho', { token: admin });
    assert.equal(r.status, 200);
    // token invalido -> 401
    assert.equal((await api('GET', '/carrinho', { token: 'lixo' })).status, 401);
  });

  await t.test('item deixa de ser vendavel: carrinho sinaliza o problema', async () => {
    const outro = await api('POST', '/carrinho/itens', { body: { variacao_id: v2.id, quantidade: 2 } });
    const c = cookieDe(outro);
    await api('PUT', `/admin/variacoes/${v2.id}/estoque`, { token: operador, body: { saldo: 1 } });
    const r = await api('GET', '/carrinho', { cookie: c });
    assert.equal(r.body.tem_problemas, true);
    assert.equal(r.body.itens[0].problema, 'ESTOQUE_INSUFICIENTE');
  });
});
