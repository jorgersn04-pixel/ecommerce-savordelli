'use strict';

const { habilitado, iniciar } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const CPF = '52998224725'; // CPF valido de teste
const base = (extra = {}) => ({
  nome: 'Maria da Silva', email: 'Maria@Teste.com', senha: 'Senha1234', cpf: '529.982.247-25',
  aceite_termos: true, consentimentos: { marketing: true }, ...extra,
});
const end = (extra = {}) => ({
  destinatario: 'Maria da Silva', cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000',
  bairro: 'Bela Vista', cidade: 'Sao Paulo', uf: 'sp', ...extra,
});

test('cadastro e area do cliente (integracao)', { skip: !habilitado && 'defina SV_TEST_DB=1' }, async (t) => {
  const ctx = await iniciar();
  const { api, pool, criarAdmin } = ctx;
  t.after(() => ctx.encerrar());

  let token;
  let refreshCookie;

  await t.test('registro: valida, cifra CPF, registra consentimentos e abre sessao', async () => {
    const r = await api('POST', '/auth/cliente/registrar', { body: base() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.usuario.email, 'maria@teste.com');
    assert.ok(r.body.access_token);
    assert.ok(!('refresh' in r.body));
    refreshCookie = r.headers.getSetCookie()[0].split(';')[0];
    assert.match(refreshCookie, /^sv_refresh_cliente=/);
    token = r.body.access_token;

    const [[c]] = await pool.query('SELECT cpf_cifrado, cpf_hash FROM clientes');
    assert.ok(Buffer.isBuffer(c.cpf_cifrado));
    assert.ok(!c.cpf_cifrado.toString('utf8').includes(CPF), 'CPF nao pode estar em texto claro');
    assert.equal(c.cpf_hash.length, 64);
    const { decifrar } = require('../src/utils/crypto');
    assert.equal(decifrar(c.cpf_cifrado), CPF);

    const [cons] = await pool.query(
      `SELECT f.codigo, r.concedido FROM consentimentos_registro r
         JOIN consentimento_finalidades f ON f.id = r.finalidade_id ORDER BY f.codigo`,
    );
    const mapa = Object.fromEntries(cons.map((x) => [x.codigo, x.concedido]));
    assert.deepEqual(mapa, { analytics: 0, essencial: 1, marketing: 1, personalizacao: 0 });
  });

  await t.test('rejeita duplicados e dados invalidos', async () => {
    assert.equal((await api('POST', '/auth/cliente/registrar', { body: base() })).status, 409);
    const outroEmailMesmoCpf = await api('POST', '/auth/cliente/registrar', { body: base({ email: 'outra@teste.com' }) });
    assert.equal(outroEmailMesmoCpf.status, 409);
    assert.equal((await api('POST', '/auth/cliente/registrar', { body: base({ cpf: '111.111.111-11', email: 'a@a.com' }) })).status, 400);
    assert.equal((await api('POST', '/auth/cliente/registrar', { body: base({ senha: 'curta', email: 'b@a.com' }) })).status, 400);
    assert.equal((await api('POST', '/auth/cliente/registrar', { body: base({ senha: 'somenteletras', email: 'c@a.com' }) })).status, 400);
    assert.equal((await api('POST', '/auth/cliente/registrar', { body: base({ aceite_termos: false, email: 'd@a.com' }) })).status, 400);
  });

  await t.test('login e refresh funcionam para o cliente cadastrado', async () => {
    const l = await api('POST', '/auth/cliente/login', { body: { email: 'maria@teste.com', senha: 'Senha1234' } });
    assert.equal(l.status, 200);
    const rr = await api('POST', '/auth/cliente/refresh', { cookie: refreshCookie });
    assert.equal(rr.status, 200);
  });

  await t.test('refresh rotativo: corrida benigna tolerada, reuso real revoga tudo, id sozinho nao revoga nada', async () => {
    const login = await api('POST', '/auth/cliente/login', { body: { email: 'maria@teste.com', senha: 'Senha1234' } });
    const c1 = login.headers.getSetCookie()[0].split(';')[0];
    const r2 = await api('POST', '/auth/cliente/refresh', { cookie: c1 });
    assert.equal(r2.status, 200);
    const c2 = r2.headers.getSetCookie()[0].split(';')[0];

    // Duas paginas renovando ao mesmo tempo com o cookie antigo: nao derruba a sessao nova.
    const corrida = await api('POST', '/auth/cliente/refresh', { cookie: c1 });
    assert.equal(corrida.status, 401);
    assert.equal(corrida.body.erro.codigo, 'REFRESH_CONCORRENTE');
    const c3 = (await api('POST', '/auth/cliente/refresh', { cookie: c2 })).headers.getSetCookie()[0].split(';')[0];
    assert.match(c3, /^sv_refresh_cliente=/, 'a sessao nova segue valida apos a corrida');

    // Quem so conhece o id (sequencial) de uma sessao revogada nao consegue revogar nada.
    const idRevogada = c1.split('=')[1].split('.')[0];
    const sondagem = await api('POST', '/auth/cliente/refresh', { cookie: `sv_refresh_cliente=${idRevogada}.${'x'.repeat(43)}` });
    assert.equal(sondagem.body.erro.codigo, 'REFRESH_INVALIDO');
    assert.equal((await api('POST', '/auth/cliente/refresh', { cookie: c3 })).status, 200, 'sondagem nao afetou as sessoes ativas');

    // Reuso com o segredo correto fora da janela = token vazado: todas as sessoes do cliente sao encerradas.
    await pool.query("UPDATE sessoes_refresh SET revogado_em = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE revogado_em IS NOT NULL");
    const reuso = await api('POST', '/auth/cliente/refresh', { cookie: c1 });
    assert.equal(reuso.body.erro.codigo, 'REFRESH_REUTILIZADO');
    const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM sessoes_refresh WHERE tipo_usuario = 'cliente' AND revogado_em IS NULL");
    assert.equal(Number(n), 0, 'nenhuma sessao de cliente restou ativa');
    assert.equal((await api('POST', '/auth/cliente/refresh', { cookie: c3 })).status, 401);
    // volta ao estado esperado pelos proximos subtestes
    const novo = await api('POST', '/auth/cliente/login', { body: { email: 'maria@teste.com', senha: 'Senha1234' } });
    assert.equal(novo.status, 200);
  });

  await t.test('perfil com CPF mascarado, sem hash de senha', async () => {
    const r = await api('GET', '/cliente/me', { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.cpf, '***.***.247-25');
    assert.ok(!('senha_hash' in r.body) && !('cpf_cifrado' in r.body));
    const u = await api('PUT', '/cliente/me', { token, body: { telefone: '(11) 91234-5678' } });
    assert.equal(u.body.telefone, '11912345678');
    assert.equal(u.body.nome, 'Maria da Silva');
    assert.equal((await api('GET', '/cliente/me')).status, 401);
    assert.equal((await api('GET', '/cliente/me', { token: await criarAdmin('a@t.com') })).status, 403);
  });

  await t.test('enderecos: primeiro vira padrao, troca de padrao, remocao promove outro', async () => {
    const a = await api('POST', '/cliente/enderecos', { token, body: end() });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.padrao, 1);
    assert.equal(a.body.cep, '01310100');
    assert.equal(a.body.uf, 'SP');
    const b = await api('POST', '/cliente/enderecos', { token, body: end({ numero: '2000', padrao: true }) });
    let lista = (await api('GET', '/cliente/enderecos', { token })).body.itens;
    assert.equal(lista.filter((e) => e.padrao).length, 1);
    assert.equal(lista[0].id, b.body.id);

    const upd = await api('PUT', `/cliente/enderecos/${a.body.id}`, { token, body: end({ complemento: 'Apto 5' }) });
    assert.equal(upd.body.complemento, 'Apto 5');
    assert.equal((await api('DELETE', `/cliente/enderecos/${b.body.id}`, { token })).status, 204);
    lista = (await api('GET', '/cliente/enderecos', { token })).body.itens;
    assert.equal(lista.length, 1);
    assert.equal(lista[0].padrao, 1);
    assert.equal((await api('POST', '/cliente/enderecos', { token, body: end({ cep: '123' }) })).status, 400);
  });

  await t.test('isolamento: outro cliente nao acessa endereco alheio', async () => {
    const o = await api('POST', '/auth/cliente/registrar', {
      body: base({ email: 'joao@teste.com', cpf: '168.995.350-09', nome: 'Joao Souza' }),
    });
    assert.equal(o.status, 201, JSON.stringify(o.body));
    const meu = (await api('GET', '/cliente/enderecos', { token })).body.itens[0];
    assert.equal((await api('PUT', `/cliente/enderecos/${meu.id}`, { token: o.body.access_token, body: end() })).status, 404);
    assert.equal((await api('DELETE', `/cliente/enderecos/${meu.id}`, { token: o.body.access_token })).status, 404);
  });
});
