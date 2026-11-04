'use strict';

const { habilitado, iniciar } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const cookieDe = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const end = {
  destinatario: 'Maria da Silva', cep: '01310100', logradouro: 'Av. Paulista', numero: '1000',
  bairro: 'Bela Vista', cidade: 'Sao Paulo', uf: 'SP',
};
const obj = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

test('LGPD: exportacao, consentimentos, solicitacoes e anonimizacao (integracao)', { skip: !habilitado && 'defina SV_TEST_DB=1' }, async (t) => {
  const ctx = await iniciar();
  const { api, pool, criarAdmin } = ctx;
  t.after(() => ctx.encerrar());
  const bling = require('../src/integrations/bling');
  const sync = require('../src/services/bling-sync.service');
  const lgpd = require('../src/services/lgpd.service');
  bling.reiniciar();

  const admin = await criarAdmin('admin@t.com', 'admin');
  const operador = await criarAdmin('op@t.com', 'operador');
  const [[{ id: adminId }]] = await pool.query("SELECT id FROM admin_usuarios WHERE email = 'admin@t.com'").then(([r]) => [r]);

  const prod = await api('POST', '/admin/produtos', {
    token: operador,
    body: {
      nome: 'Sabonete', status: 'ativo',
      variacoes: [{ sku: 'SAB-1', preco: '20.00', peso_g: 100, altura_cm: 5, largura_cm: 5, comprimento_cm: 5 }],
    },
  });
  const vid = prod.body.variacoes[0].id;
  await api('PUT', `/admin/variacoes/${vid}/estoque`, { token: operador, body: { saldo: 50 } });

  const registrar = async (nome, email, cpf, extra = {}) => {
    const r = await api('POST', '/auth/cliente/registrar', {
      body: { nome, email, senha: 'Senha1234', cpf, telefone: '11912345678', aceite_termos: true, consentimentos: { marketing: true }, ...extra },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const token = r.body.access_token;
    const e = await api('POST', '/cliente/enderecos', { token, body: { ...end, destinatario: nome } });
    return { token, id: r.body.usuario.id, enderecoId: e.body.id, refreshCookie: cookieDe(r) };
  };
  const maria = await registrar('Maria da Silva', 'maria@t.com', '52998224725');
  const joao = await registrar('Joao Souza', 'joao@t.com', '16899535009');

  const comprar = async (cli, pagamento) => {
    await api('POST', '/carrinho/itens', { token: cli.token, body: { variacao_id: vid, quantidade: 1 } });
    const r = await api('POST', '/pedidos', { token: cli.token, body: { endereco_id: cli.enderecoId, frete_servico: '1', pagamento } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.pedido;
  };

  const pago = await comprar(maria, { metodo: 'cartao_credito', token: 'tok_ok123', payment_method_id: 'visa' });
  assert.equal(pago.status, 'pago');
  const pix = await comprar(maria, { metodo: 'pix' });
  const cancelado = await api('POST', `/pedidos/${pix.numero}/cancelar`, { token: maria.token });
  assert.equal(cancelado.body.status, 'cancelado');
  await api('POST', '/carrinho/itens', { token: maria.token, body: { variacao_id: vid, quantidade: 2 } }); // carrinho aberto

  await t.test('exportacao: completa, sem segredos, com registro da solicitacao', async () => {
    assert.equal((await api('GET', '/cliente/lgpd/exportar')).status, 401);
    assert.equal((await api('GET', '/cliente/lgpd/exportar', { token: admin })).status, 403);

    const r = await api('GET', '/cliente/lgpd/exportar', { token: maria.token });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="meus-dados-savordelli\.json"/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const d = r.body;
    assert.equal(d.titular.cpf, '52998224725');
    assert.equal(d.titular.email, 'maria@t.com');
    assert.equal(d.enderecos.length, 1);
    assert.equal(d.pedidos.length, 2);
    const pPago = d.pedidos.find((p) => p.numero === pago.numero);
    assert.equal(pPago.itens[0].sku, 'SAB-1');
    assert.equal(pPago.pagamentos[0].status, 'aprovado');
    assert.equal(pPago.endereco_de_entrega.cep, '01310100');
    assert.ok(pPago.historico_de_status.length >= 2);
    assert.equal(d.carrinho_aberto[0].quantidade, 2);
    assert.deepEqual([...new Set(d.consentimentos_historico.map((c) => c.finalidade))].sort(), ['analytics', 'essencial', 'marketing', 'personalizacao']);

    const bruto = JSON.stringify(d);
    for (const proibido of ['senha_hash', 'cpf_hash', 'cpf_cifrado', 'provedor_transacao_id', 'token_hash', 'joao@t.com', '16899535009']) {
      assert.ok(!bruto.includes(proibido), `export nao pode conter ${proibido}`);
    }
    const [sol] = await pool.query("SELECT tipo, status FROM solicitacoes_titular WHERE cliente_id = ? AND tipo = 'portabilidade'", [maria.id]);
    assert.deepEqual(sol.map((s) => s.status), ['concluida']);

    const dj = await api('GET', '/cliente/lgpd/exportar', { token: joao.token });
    assert.equal(dj.body.pedidos.length, 0, 'cada titular exporta somente os proprios dados');
  });

  await t.test('consentimentos: leitura, revogacao append-only e idempotencia', async () => {
    let r = await api('GET', '/cliente/lgpd/consentimentos', { token: maria.token });
    const mapa = () => Object.fromEntries(r.body.itens.map((i) => [i.codigo, i.concedido]));
    assert.deepEqual(mapa(), { essencial: true, analytics: false, marketing: true, personalizacao: false });

    const antes = (await pool.query('SELECT COUNT(*) n FROM consentimentos_registro WHERE cliente_id = ?', [maria.id]))[0][0].n;
    r = await api('PUT', '/cliente/lgpd/consentimentos', { token: maria.token, body: { marketing: false, analytics: true } });
    assert.equal(r.status, 200);
    assert.deepEqual(mapa(), { essencial: true, analytics: true, marketing: false, personalizacao: false });
    const depois = (await pool.query('SELECT COUNT(*) n FROM consentimentos_registro WHERE cliente_id = ?', [maria.id]))[0][0].n;
    assert.equal(Number(depois), Number(antes) + 2, 'duas mudancas = duas linhas novas (historico preservado)');
    const [rev] = await pool.query("SELECT detalhes FROM solicitacoes_titular WHERE cliente_id = ? AND tipo = 'revogacao'", [maria.id]);
    assert.match(rev[0].detalhes, /marketing/);

    await api('PUT', '/cliente/lgpd/consentimentos', { token: maria.token, body: { marketing: false } });
    const igual = (await pool.query('SELECT COUNT(*) n FROM consentimentos_registro WHERE cliente_id = ?', [maria.id]))[0][0].n;
    assert.equal(Number(igual), Number(depois), 'sem mudanca nao grava linha');

    assert.equal((await api('PUT', '/cliente/lgpd/consentimentos', { token: maria.token, body: {} })).status, 400);
    assert.equal((await api('PUT', '/cliente/lgpd/consentimentos', { token: maria.token, body: { essencial: false } })).status, 400);
  });

  await t.test('solicitacoes: prazo legal, duplicidade e listagem', async () => {
    const r = await api('POST', '/cliente/lgpd/solicitacoes', { token: joao.token, body: { tipo: 'correcao', detalhes: 'Meu nome esta errado' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'aberta');
    const dias = Math.round((new Date(r.body.prazo_em) - Date.now()) / 86_400_000);
    assert.ok(dias >= 14 && dias <= 16, `prazo de ~15 dias (obtido ${dias})`);
    assert.equal((await api('POST', '/cliente/lgpd/solicitacoes', { token: joao.token, body: { tipo: 'correcao' } })).status, 409);
    assert.equal((await api('POST', '/cliente/lgpd/solicitacoes', { token: joao.token, body: { tipo: 'invalido' } })).status, 400);
    const lista = await api('GET', '/cliente/lgpd/solicitacoes', { token: joao.token });
    assert.deepEqual(lista.body.itens.map((s) => s.tipo).sort(), ['correcao', 'portabilidade'], 'inclui a exportacao feita antes');
    assert.equal((await api('GET', '/cliente/lgpd/solicitacoes', { token: maria.token })).body.itens.every((s) => s.tipo !== 'correcao'), true);
  });

  await t.test('anonimizacao pelo titular: confirmacao, senha e pedidos em andamento', async () => {
    const ok = { senha: 'Senha1234', confirmacao: 'EXCLUIR' };
    assert.equal((await api('POST', '/cliente/lgpd/anonimizar', { token: maria.token, body: { senha: 'Senha1234' } })).status, 400);
    assert.equal((await api('POST', '/cliente/lgpd/anonimizar', { token: maria.token, body: { ...ok, confirmacao: 'sim' } })).status, 400);
    const errada = await api('POST', '/cliente/lgpd/anonimizar', { token: maria.token, body: { ...ok, senha: 'errada123' } });
    assert.equal(errada.status, 403);
    assert.equal(errada.body.erro.codigo, 'SENHA_INCORRETA');

    const bloqueado = await api('POST', '/cliente/lgpd/anonimizar', { token: maria.token, body: ok });
    assert.equal(bloqueado.status, 409);
    assert.equal(bloqueado.body.erro.codigo, 'PEDIDOS_EM_ANDAMENTO');
    assert.equal((await pool.query('SELECT anonimizado_em a FROM clientes WHERE id = ?', [maria.id]))[0][0].a, null, 'nada foi alterado');
  });

  await t.test('apos concluir o pedido, a anonimizacao remove dados pessoais e preserva a guarda fiscal', async () => {
    const [[ped]] = await pool.query('SELECT id FROM pedidos WHERE numero = ?', [pago.numero]).then(([r]) => [r]);
    for (const status of ['em_separacao', 'enviado', 'entregue']) {
      assert.equal((await api('PUT', `/admin/pedidos/${ped.id}/status`, { token: operador, body: { status } })).status, 200);
    }
    await pool.query('UPDATE clientes SET bling_contato_id = 555 WHERE id = ?', [maria.id]);

    const r = await api('POST', '/cliente/lgpd/anonimizar', { token: maria.token, body: { senha: 'Senha1234', confirmacao: 'EXCLUIR' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    const [[c]] = await pool.query('SELECT * FROM clientes WHERE id = ?', [maria.id]).then(([x]) => [x]);
    assert.equal(c.nome, 'Cliente anonimizado');
    assert.equal(c.email, `anonimizado+${maria.id}@anonimizado.invalid`);
    for (const campo of ['cpf_cifrado', 'cpf_hash', 'telefone', 'data_nascimento', 'bling_contato_id']) assert.equal(c[campo], null, campo);
    assert.ok(c.anonimizado_em);
    assert.equal(c.senha_hash, '!anonimizado');

    const n = async (sql, p) => Number((await pool.query(sql, p))[0][0].n);
    assert.equal(await n('SELECT COUNT(*) n FROM enderecos WHERE cliente_id = ?', [maria.id]), 0);
    assert.equal(await n('SELECT COUNT(*) n FROM carrinhos WHERE cliente_id = ?', [maria.id]), 0);
    assert.equal(await n("SELECT COUNT(*) n FROM sessoes_refresh WHERE usuario_id = ? AND tipo_usuario = 'cliente' AND revogado_em IS NULL", [maria.id]), 0);

    const [peds] = await pool.query('SELECT numero, cliente_id, snapshot_cliente, snapshot_endereco FROM pedidos');
    assert.equal(peds.length, 2, 'pedidos permanecem');
    assert.ok(peds.every((p) => p.cliente_id === null));
    const retido = peds.find((p) => p.numero === pago.numero);
    const sc = obj(retido.snapshot_cliente);
    assert.equal(sc.nome, 'Maria da Silva', 'guarda fiscal: nome mantido');
    assert.ok(sc.cpf_cifrado, 'guarda fiscal: CPF (cifrado) mantido');
    assert.ok(!('email' in sc) && !('telefone' in sc) && !('cliente_id' in sc), 'e-mail, telefone e vinculo removidos');
    assert.equal(obj(retido.snapshot_endereco).cep, '01310100');
    const limpo = peds.find((p) => p.numero === pix.numero);
    assert.deepEqual(obj(limpo.snapshot_cliente), { anonimizado: true });
    assert.deepEqual(obj(limpo.snapshot_endereco), { anonimizado: true });

    assert.ok((await n('SELECT COUNT(*) n FROM consentimentos_registro WHERE cliente_id = ?', [maria.id])) > 0, 'prova de consentimento preservada');
    const [sol] = await pool.query('SELECT tipo, status, detalhes FROM solicitacoes_titular WHERE cliente_id = ?', [maria.id]);
    assert.ok(sol.some((s) => s.tipo === 'exclusao' && s.status === 'concluida'));
    assert.ok(sol.every((s) => s.detalhes === null));
    const [aud] = await pool.query("SELECT admin_id, detalhes FROM logs_auditoria WHERE acao = 'cliente.anonimizar'");
    assert.equal(aud.length, 1);
    assert.equal(aud[0].admin_id, null, 'acao do titular nao e atribuida a um admin');
    assert.equal(obj(aud[0].detalhes).origem, 'titular');

    // Bling: contato descaracterizado pelo worker
    const [fila] = await pool.query("SELECT payload FROM bling_sync_fila WHERE entidade = 'contato' AND status = 'pendente'");
    assert.equal(fila.length, 1);
    await pool.query("UPDATE bling_sync_fila SET status = 'sucesso'  WHERE entidade <> 'contato'");
    const ciclo = await sync.executarCiclo();
    assert.equal(ciclo.sucesso, 1);
    assert.deepEqual(bling.estado.contatosAnonimizados, ['555']);
  });

  await t.test('conta anonimizada nao acessa nada e dados podem ser recadastrados', async () => {
    assert.equal((await api('GET', '/cliente/me', { token: maria.token })).status, 404);
    assert.equal((await api('GET', '/cliente/lgpd/exportar', { token: maria.token })).status, 404);
    assert.equal((await api('POST', '/cliente/lgpd/anonimizar', { token: maria.token, body: { senha: 'Senha1234', confirmacao: 'EXCLUIR' } })).status, 404);
    const login = await api('POST', '/auth/cliente/login', { body: { email: 'maria@t.com', senha: 'Senha1234' } });
    assert.equal(login.status, 401);
    assert.equal((await api('POST', '/auth/cliente/refresh', { cookie: maria.refreshCookie })).status, 401);
    const checkout = await api('POST', '/pedidos', { token: maria.token, body: { endereco_id: maria.enderecoId, frete_servico: '1', pagamento: { metodo: 'pix' } } });
    assert.ok([404, 422].includes(checkout.status));

    // e-mail e CPF ficam livres para um novo cadastro
    const novo = await api('POST', '/auth/cliente/registrar', {
      body: { nome: 'Maria da Silva', email: 'maria@t.com', senha: 'Senha1234', cpf: '52998224725', aceite_termos: true },
    });
    assert.equal(novo.status, 201);
  });

  await t.test('admin: RBAC, fila de solicitacoes com prazo, transicoes e justificativa', async () => {
    assert.equal((await api('GET', '/admin/lgpd/solicitacoes', { token: operador })).status, 403);
    assert.equal((await api('GET', '/admin/lgpd/solicitacoes')).status, 401);

    await pool.query("UPDATE solicitacoes_titular SET prazo_em = UTC_DATE() - INTERVAL 2 DAY WHERE cliente_id = ? AND tipo = 'correcao'", [joao.id]);
    const lista = await api('GET', '/admin/lgpd/solicitacoes?status=aberta', { token: admin });
    assert.equal(lista.status, 200);
    const sol = lista.body.itens.find((s) => s.tipo === 'correcao');
    assert.equal(sol.atrasada, true);
    assert.equal(sol.cliente_email, 'joao@t.com');
    assert.equal(lista.body.itens[0].id, sol.id, 'atrasadas primeiro');

    assert.equal((await api('PUT', `/admin/lgpd/solicitacoes/${sol.id}`, { token: admin, body: { status: 'em_analise' } })).status, 204);
    assert.equal((await api('PUT', `/admin/lgpd/solicitacoes/${sol.id}`, { token: admin, body: { status: 'negada' } })).status, 400);
    assert.equal((await api('PUT', `/admin/lgpd/solicitacoes/${sol.id}`, { token: admin, body: { status: 'negada', nota: 'Dado ja esta correto conforme documento' } })).status, 204);
    assert.equal((await api('PUT', `/admin/lgpd/solicitacoes/${sol.id}`, { token: admin, body: { status: 'concluida' } })).status, 409, 'estado final nao reabre');
    const [aud] = await pool.query("SELECT admin_id, detalhes FROM logs_auditoria WHERE acao = 'lgpd.solicitacao'");
    assert.equal(aud.length, 2);
    assert.equal(String(aud[0].admin_id), String(adminId));
    assert.match(JSON.stringify(aud.map((a) => obj(a.detalhes))), /ja esta correto/);
  });

  await t.test('admin: exporta e anonimiza em nome do titular, com auditoria', async () => {
    assert.equal((await api('GET', `/admin/lgpd/clientes/${joao.id}/exportar`, { token: operador })).status, 403);
    const ex = await api('GET', `/admin/lgpd/clientes/${joao.id}/exportar`, { token: admin });
    assert.equal(ex.status, 200);
    assert.equal(ex.body.titular.cpf, '16899535009');
    assert.equal((await api('GET', `/admin/lgpd/clientes/${maria.id}/exportar`, { token: admin })).status, 404, 'cliente ja anonimizado');
    const [audEx] = await pool.query("SELECT admin_id FROM logs_auditoria WHERE acao = 'cliente.exportar'");
    assert.equal(String(audEx[0].admin_id), String(adminId));

    const pedidoExclusao = await api('POST', '/cliente/lgpd/solicitacoes', { token: joao.token, body: { tipo: 'exclusao', detalhes: 'Quero sair' } });
    assert.equal((await api('POST', `/admin/lgpd/clientes/${joao.id}/anonimizar`, { token: admin, body: {} })).status, 400, 'motivo obrigatorio');
    const r = await api('POST', `/admin/lgpd/clientes/${joao.id}/anonimizar`, {
      token: admin, body: { motivo: 'Pedido do titular por e-mail, identidade confirmada', solicitacao_id: pedidoExclusao.body.id },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const [[c]] = await pool.query('SELECT nome, anonimizado_em a FROM clientes WHERE id = ?', [joao.id]).then(([x]) => [x]);
    assert.equal(c.nome, 'Cliente anonimizado');
    const [[s]] = await pool.query('SELECT status FROM solicitacoes_titular WHERE id = ?', [pedidoExclusao.body.id]).then(([x]) => [x]);
    assert.equal(s.status, 'concluida');
    const [audAn] = await pool.query("SELECT admin_id, detalhes FROM logs_auditoria WHERE acao = 'cliente.anonimizar' ORDER BY id DESC LIMIT 1");
    assert.equal(String(audAn[0].admin_id), String(adminId));
    assert.equal(obj(audAn[0].detalhes).origem, 'admin');
    assert.equal((await api('POST', `/admin/lgpd/clientes/${joao.id}/anonimizar`, { token: admin, body: { motivo: 'repetido ai' } })).status, 409);
    assert.equal((await api('POST', '/admin/lgpd/clientes/999999/anonimizar', { token: admin, body: { motivo: 'inexistente' } })).status, 404);
  });

  await t.test('expurgo: apos 5 anos os snapshots retidos tambem sao apagados', async () => {
    assert.equal(await lgpd.expurgarSnapshotsVencidos(), 0, 'nada vencido ainda');
    await pool.query('UPDATE pedidos SET criado_em = UTC_TIMESTAMP() - INTERVAL 6 YEAR WHERE numero = ?', [pago.numero]);
    assert.equal(await lgpd.expurgarSnapshotsVencidos(), 1);
    const [[p]] = await pool.query('SELECT snapshot_cliente c, snapshot_endereco e FROM pedidos WHERE numero = ?', [pago.numero]).then(([x]) => [x]);
    assert.deepEqual(obj(p.c), { anonimizado: true });
    assert.deepEqual(obj(p.e), { anonimizado: true });
    assert.equal(await lgpd.expurgarSnapshotsVencidos(), 0, 'idempotente');
  });
});
