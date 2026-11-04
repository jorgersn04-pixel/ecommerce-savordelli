'use strict';

const { habilitado, iniciar } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const cookieDe = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const end = {
  destinatario: 'Maria da Silva', cep: '01310100', logradouro: 'Av. Paulista', numero: '1000',
  bairro: 'Bela Vista', cidade: 'Sao Paulo', uf: 'SP',
};

test('pedidos e pagamentos (integracao, gateway simulado)', { skip: !habilitado && 'defina SV_TEST_DB=1' }, async (t) => {
  const ctx = await iniciar();
  const { api, pool, criarAdmin } = ctx;
  t.after(() => ctx.encerrar());
  const gateway = require('../src/integrations/mercadopago/client');
  const pedidoSvc = require('../src/services/pedido.service');
  assert.ok(gateway.simulado, 'este teste exige o gateway simulado (sem MERCADOPAGO_ACCESS_TOKEN)');

  const admin = await criarAdmin('admin@t.com', 'admin');
  const operador = await criarAdmin('op@t.com', 'operador');
  const financeiro = await criarAdmin('fin@t.com', 'financeiro');

  const prod = await api('POST', '/admin/produtos', {
    token: operador,
    body: {
      nome: 'Perfume', status: 'ativo',
      variacoes: [{ sku: 'P-1', preco: '100.00', peso_g: 500, altura_cm: 10, largura_cm: 10, comprimento_cm: 10 }],
    },
  });
  const vid = prod.body.variacoes[0].id;
  const estoque = async () => {
    const [[v]] = await pool.query('SELECT estoque_disponivel d, estoque_reservado r FROM produto_variacoes WHERE id = ?', [vid]);
    return { d: v.d, r: v.r };
  };
  await api('PUT', `/admin/variacoes/${vid}/estoque`, { token: operador, body: { saldo: 10 } });
  await api('POST', '/admin/cupons', { token: admin, body: { codigo: 'DEZ', tipo: 'percentual', valor: 10, limite_usos: 5 } });
  await api('POST', '/admin/cupons', { token: admin, body: { codigo: 'FRETE', tipo: 'frete_gratis' } });

  const registrar = async (email, cpf) => {
    const r = await api('POST', '/auth/cliente/registrar', {
      body: { nome: 'Maria da Silva', email, senha: 'Senha1234', cpf, aceite_termos: true },
    });
    const token = r.body.access_token;
    const e = await api('POST', '/cliente/enderecos', { token, body: end });
    return { token, enderecoId: e.body.id };
  };
  const maria = await registrar('maria@t.com', '52998224725');
  const joao = await registrar('joao@t.com', '16899535009');

  const adicionar = async (token, quantidade = 2) => {
    const r = await api('POST', '/carrinho/itens', { token, body: { variacao_id: vid, quantidade } });
    return cookieDe(r);
  };
  const checkout = (cli, pagamento, extra = {}) =>
    api('POST', '/pedidos', { token: cli.token, body: { endereco_id: cli.enderecoId, frete_servico: '1', pagamento, ...extra } });

  let pix;

  await t.test('exige login e carrinho', async () => {
    assert.equal((await api('POST', '/pedidos', { body: {} })).status, 401);
    const r = await checkout(maria, { metodo: 'pix' });
    assert.equal(r.status, 422);
    assert.equal(r.body.erro.codigo, 'CARRINHO_VAZIO');
  });

  await t.test('checkout PIX: totais no servidor, reserva de estoque, QR code', async () => {
    await adicionar(maria.token, 2);
    const r = await checkout(maria, { metodo: 'pix' }, { cupom: 'DEZ' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    pix = r.body;
    assert.match(pix.pedido.numero, /^SV-\d{4}-\d{6}$/);
    assert.equal(pix.pedido.status, 'aguardando_pagamento');
    assert.equal(pix.pedido.subtotal, '200.00');
    assert.equal(pix.pedido.desconto, '20.00');
    const total = Number(pix.pedido.frete.valor) + 180;
    assert.equal(pix.pedido.total, total.toFixed(2));
    assert.equal(pix.pagamento.status, 'pendente');
    assert.ok(pix.pagamento.pix.qr_code);
    assert.ok(!JSON.stringify(pix).includes('cpf_cifrado'), 'CPF cifrado nao pode vazar na resposta');
    assert.deepEqual(await estoque(), { d: 10, r: 2 });

    // carrinho convertido e cupom consumido
    const cart = await api('GET', '/carrinho', { token: maria.token });
    assert.equal(cart.body.itens.length, 0);
    const [[c]] = await pool.query("SELECT usos FROM cupons WHERE codigo = 'DEZ'");
    assert.equal(c.usos, 1);
    const [[snap]] = await pool.query('SELECT snapshot_endereco e FROM pedidos');
    assert.equal((typeof snap.e === 'string' ? JSON.parse(snap.e) : snap.e).cep, '01310100');
  });

  await t.test('webhook aprova o pagamento: baixa estoque, historico e outbox; repetir e idempotente', async () => {
    const [[pg]] = await pool.query("SELECT provedor_transacao_id t FROM pagamentos WHERE metodo = 'pix'");
    gateway.definirStatusSimulado(pg.t, 'approved');
    const hook = () => api('POST', `/webhooks/mercadopago?type=payment&data.id=${pg.t}`, { body: { type: 'payment', data: { id: pg.t } } });
    assert.equal((await hook()).status, 200);
    assert.equal((await hook()).status, 200);

    const det = await api('GET', `/pedidos/${pix.pedido.numero}`, { token: maria.token });
    assert.equal(det.body.status, 'pago');
    assert.equal(det.body.pagamentos[0].status, 'aprovado');
    assert.deepEqual(await estoque(), { d: 8, r: 0 });
    const [fila] = await pool.query("SELECT * FROM bling_sync_fila WHERE entidade = 'pedido' AND operacao = 'criar'");
    assert.equal(fila.length, 1);
    const [mov] = await pool.query("SELECT tipo FROM estoque_movimentacoes WHERE pedido_id IS NOT NULL ORDER BY id");
    assert.deepEqual(mov.map((m) => m.tipo), ['reserva', 'saida']);
    // webhook de pagamento desconhecido nao quebra
    assert.equal((await api('POST', '/webhooks/mercadopago?type=payment&data.id=999')).status, 200);
    assert.equal((await api('POST', '/webhooks/mercadopago?type=plan&data.id=1')).status, 200);
  });

  await t.test('cartao aprovado direto; cartao recusado permite nova tentativa', async () => {
    await adicionar(maria.token, 1);
    const ok = await checkout(maria, { metodo: 'cartao_credito', token: 'tok_valido', payment_method_id: 'visa', parcelas: 3 });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.pedido.status, 'pago');
    assert.equal(ok.body.pagamento.parcelas, 3);
    assert.deepEqual(await estoque(), { d: 7, r: 0 });

    await adicionar(maria.token, 1);
    const ruim = await checkout(maria, { metodo: 'cartao_credito', token: 'tok_recusado', payment_method_id: 'visa' });
    assert.equal(ruim.status, 201);
    assert.equal(ruim.body.pagamento.status, 'recusado');
    assert.equal(ruim.body.pedido.status, 'aguardando_pagamento');
    assert.deepEqual(await estoque(), { d: 7, r: 1 });

    const retry = await api('POST', `/pedidos/${ruim.body.pedido.numero}/pagar`, {
      token: maria.token, body: { pagamento: { metodo: 'cartao_credito', token: 'tok_valido2', payment_method_id: 'master' } },
    });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.pedido.status, 'pago');
    assert.equal(retry.body.pedido.pagamentos.length, 2);
    assert.deepEqual(await estoque(), { d: 6, r: 0 });

    // pedido pago nao aceita novo pagamento
    const de_novo = await api('POST', `/pedidos/${ruim.body.pedido.numero}/pagar`, { token: maria.token, body: { pagamento: { metodo: 'pix' } } });
    assert.equal(de_novo.status, 409);
  });

  await t.test('estoque insuficiente: 409, nada reservado, carrinho intacto', async () => {
    await adicionar(joao.token, 6); // saldo livre = 6
    await api('PUT', `/admin/variacoes/${vid}/estoque`, { token: operador, body: { saldo: 3 } });
    const r = await checkout(joao, { metodo: 'pix' });
    assert.ok([409].includes(r.status), JSON.stringify(r.body));
    assert.deepEqual(await estoque(), { d: 3, r: 0 });
    const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM pedidos WHERE cliente_id = (SELECT id FROM clientes WHERE email='joao@t.com')");
    assert.equal(Number(n), 0);
    const cart = await api('GET', '/carrinho', { token: joao.token });
    assert.equal(cart.body.itens.length, 1);
    await api('PUT', `/admin/variacoes/${vid}/estoque`, { token: operador, body: { saldo: 20 } });
    await api('PUT', `/carrinho/itens/${vid}`, { token: joao.token, body: { quantidade: 2 } });
  });

  await t.test('frete invalido, endereco alheio e cupom invalido', async () => {
    assert.equal((await checkout(joao, { metodo: 'pix' }, { frete_servico: '99' })).body.erro.codigo, 'FRETE_SERVICO_INVALIDO');
    assert.equal((await api('POST', '/pedidos', {
      token: joao.token, body: { endereco_id: maria.enderecoId, frete_servico: '1', pagamento: { metodo: 'pix' } },
    })).status, 404);
    assert.equal((await checkout(joao, { metodo: 'pix' }, { cupom: 'NAOEXISTE' })).status, 422);
    assert.equal((await checkout(joao, { metodo: 'cartao_credito' })).status, 400);
    const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM pedidos WHERE cliente_id = (SELECT id FROM clientes WHERE email='joao@t.com')");
    assert.equal(Number(n), 0);
  });

  await t.test('frete gratis (cupom) e cancelamento pelo cliente libera estoque e cupom', async () => {
    const antes = await estoque();
    const r = await checkout(joao, { metodo: 'boleto' }, { cupom: 'FRETE' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.pedido.frete.valor, '0.00');
    assert.ok(r.body.pagamento.boleto.url);
    assert.equal((await estoque()).r, antes.r + 2);

    const outro = await api('POST', `/pedidos/${r.body.pedido.numero}/cancelar`, { token: maria.token });
    assert.equal(outro.status, 404, 'cliente nao cancela pedido alheio');
    const c = await api('POST', `/pedidos/${r.body.pedido.numero}/cancelar`, { token: joao.token });
    assert.equal(c.status, 200);
    assert.equal(c.body.status, 'cancelado');
    assert.deepEqual(await estoque(), antes);
    const [[cup]] = await pool.query("SELECT usos FROM cupons WHERE codigo = 'FRETE'");
    assert.equal(cup.usos, 0);
    assert.equal((await api('POST', `/pedidos/${r.body.pedido.numero}/cancelar`, { token: joao.token })).status, 409);
  });

  await t.test('job de expiracao cancela pedido nao pago e devolve reserva', async () => {
    await adicionar(joao.token, 2);
    const r = await checkout(joao, { metodo: 'pix' }, { cupom: 'DEZ' });
    const antes = await estoque();
    assert.equal(await pedidoSvc.expirarPendentes(), 0); // ainda dentro do prazo
    await pool.query("UPDATE pedidos SET criado_em = UTC_TIMESTAMP() - INTERVAL 2 HOUR WHERE numero = ?", [r.body.pedido.numero]);
    assert.equal(await pedidoSvc.expirarPendentes(), 1);
    assert.equal((await estoque()).r, antes.r - 2);
    const det = await api('GET', `/pedidos/${r.body.pedido.numero}`, { token: joao.token });
    assert.equal(det.body.status, 'cancelado');
    assert.equal(det.body.pagamentos[0].status, 'expirado');
    const [[cup]] = await pool.query("SELECT usos FROM cupons WHERE codigo = 'DEZ'");
    assert.equal(cup.usos, 1); // so o pedido pago da Maria permanece
  });

  await t.test('isolamento entre clientes e listagem propria', async () => {
    assert.equal((await api('GET', `/pedidos/${pix.pedido.numero}`, { token: joao.token })).status, 404);
    const lista = await api('GET', '/pedidos', { token: maria.token });
    assert.equal(lista.body.itens.length, 3);
    assert.equal((await api('GET', '/pedidos/lixo', { token: maria.token })).status, 400);
    const pg = await api('GET', `/pedidos/${pix.pedido.numero}/pagamento`, { token: maria.token });
    assert.equal(pg.body.status_pedido, 'pago');
  });

  await t.test('admin: RBAC, detalhe auditado e maquina de estados', async () => {
    const lista = await api('GET', '/admin/pedidos?status=pago', { token: financeiro });
    assert.equal(lista.status, 200);
    assert.equal(lista.body.itens.length, 3);
    const id = lista.body.itens[0].id;

    const det = await api('GET', `/admin/pedidos/${id}`, { token: financeiro });
    assert.equal(det.status, 200);
    assert.ok(det.body.historico[0].autor);
    assert.ok(!JSON.stringify(det.body).includes('cpf_cifrado'));
    const [aud] = await pool.query("SELECT * FROM logs_auditoria WHERE acao = 'pedido.visualizar'");
    assert.equal(aud.length, 1);

    assert.equal((await api('PUT', `/admin/pedidos/${id}/status`, { token: financeiro, body: { status: 'em_separacao' } })).status, 403);
    assert.equal((await api('PUT', `/admin/pedidos/${id}/status`, { token: operador, body: { status: 'entregue' } })).status, 409);

    const sep = await api('PUT', `/admin/pedidos/${id}/status`, { token: operador, body: { status: 'em_separacao' } });
    assert.equal(sep.body.status, 'em_separacao');
    const env = await api('PUT', `/admin/pedidos/${id}/status`, { token: operador, body: { status: 'enviado', codigo_rastreio: 'BR123456789' } });
    assert.equal(env.body.envios[0].codigo_rastreio, 'BR123456789');
    const ent = await api('PUT', `/admin/pedidos/${id}/status`, { token: operador, body: { status: 'entregue' } });
    assert.equal(ent.body.status, 'entregue');
    assert.equal(ent.body.envios[0].status, 'entregue');
  });

  await t.test('admin cancela pedido pago: estoque volta e fica marcado reembolso pendente', async () => {
    const lista = await api('GET', '/admin/pedidos?status=pago', { token: admin });
    const alvo = lista.body.itens[0];
    const antes = await estoque();
    const r = await api('PUT', `/admin/pedidos/${alvo.id}/status`, { token: admin, body: { status: 'cancelado', observacao: 'Cliente desistiu' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await estoque()).d, antes.d + 1);
    const det = await api('GET', `/admin/pedidos/${alvo.id}`, { token: admin });
    assert.match(det.body.historico.at(-1).observacao, /reembolso pendente/);
  });

  await t.test('estorno via gateway marca pedido como reembolsado', async () => {
    const [[pg]] = await pool.query(
      "SELECT g.provedor_transacao_id t FROM pagamentos g JOIN pedidos p ON p.id = g.pedido_id WHERE p.numero = ?", [pix.pedido.numero]);
    gateway.definirStatusSimulado(pg.t, 'refunded');
    await api('POST', `/webhooks/mercadopago?type=payment&data.id=${pg.t}`);
    const det = await api('GET', `/pedidos/${pix.pedido.numero}`, { token: maria.token });
    assert.equal(det.body.status, 'reembolsado');
  });

  await t.test('assinatura do webhook (HMAC) e validada', async () => {
    const crypto = require('crypto');
    const secret = 'segredo-de-teste';
    const ts = '1700000000';
    const v1 = crypto.createHmac('sha256', secret).update(`id:abc123;request-id:req-1;ts:${ts};`).digest('hex');
    const base = { requestId: 'req-1', dataId: 'ABC123', secret };
    assert.equal(gateway.verificarAssinatura({ ...base, assinatura: `ts=${ts},v1=${v1}` }), true);
    assert.equal(gateway.verificarAssinatura({ ...base, assinatura: `ts=${ts},v1=${'0'.repeat(64)}` }), false);
    assert.equal(gateway.verificarAssinatura({ ...base, assinatura: undefined }), false);
    assert.equal(gateway.verificarAssinatura({ ...base, requestId: 'outro', assinatura: `ts=${ts},v1=${v1}` }), false);
  });
});
