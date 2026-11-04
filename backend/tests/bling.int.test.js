'use strict';

const { habilitado, iniciar } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const end = {
  destinatario: 'Maria da Silva', cep: '01310100', logradouro: 'Av. Paulista', numero: '1000',
  bairro: 'Bela Vista', cidade: 'Sao Paulo', uf: 'SP',
};

test('integracao Bling (outbox, worker e webhook)', { skip: !habilitado && 'defina SV_TEST_DB=1' }, async (t) => {
  const ctx = await iniciar();
  const { api, pool, criarAdmin } = ctx;
  t.after(() => ctx.encerrar());
  const bling = require('../src/integrations/bling');
  const sync = require('../src/services/bling-sync.service');
  const webhookSvc = require('../src/services/bling-webhook.service');
  assert.ok(bling.simulado, 'este teste exige o Bling simulado (sem BLING_CLIENT_ID)');
  bling.reiniciar();

  const admin = await criarAdmin('admin@t.com', 'admin');
  const operador = await criarAdmin('op@t.com', 'operador');

  const fila = async (cond = '1=1') => (await pool.query(`SELECT * FROM bling_sync_fila WHERE ${cond} ORDER BY id`))[0];
  const ciclo = async () => {
    // permite repetir itens em backoff sem esperar
    await pool.query("UPDATE bling_sync_fila SET proxima_tentativa_em = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE status IN ('pendente','erro')");
    return sync.executarCiclo();
  };

  let produto;
  let variacao;

  await t.test('produto novo: worker cria no Bling por SKU e guarda o id', async () => {
    const r = await api('POST', '/admin/produtos', {
      token: operador,
      body: {
        nome: 'Hidratante', status: 'ativo', ncm: '33049990', descricao_curta: 'Hidrata',
        variacoes: [{ sku: 'HID-1', preco: '50.00', peso_g: 400, altura_cm: 10, largura_cm: 8, comprimento_cm: 6, atributos: { volume: '200ml' } }],
        imagens: [{ url: 'https://cdn.exemplo.com/h.jpg' }],
      },
    });
    produto = r.body;
    variacao = produto.variacoes[0];
    assert.equal((await fila("status = 'pendente'")).length, 1);

    const res = await ciclo();
    assert.deepEqual([res.processados, res.sucesso], [1, 1]);
    const [[v]] = await pool.query('SELECT bling_variacao_id b FROM produto_variacoes WHERE id = ?', [variacao.id]);
    assert.ok(v.b);
    const noBling = bling.estado.produtos.get('HID-1');
    assert.equal(noBling.payload.nome, 'Hidratante - 200ml');
    assert.equal(noBling.payload.formato, 'S');
    assert.equal(noBling.payload.situacao, 'A');
    assert.equal(noBling.payload.pesoLiquido, 0.4);
    assert.equal(noBling.payload.tributacao.ncm, '33049990');
    assert.equal(noBling.payload.midia.imagens.externas[0].link, 'https://cdn.exemplo.com/h.jpg');
    const [logs] = await pool.query("SELECT * FROM bling_sync_logs WHERE direcao = 'saida'");
    assert.equal(logs.length, 1);
  });

  await t.test('atualizacao reaproveita o id (PUT) e nao duplica', async () => {
    await api('PUT', `/admin/variacoes/${variacao.id}`, { token: operador, body: { preco: '55.00' } });
    await ciclo();
    assert.equal(bling.estado.produtos.size, 1);
    assert.equal(bling.estado.produtos.get('HID-1').payload.preco, 55);
    assert.equal(bling.estado.chamadas.filter((c) => c.nome === 'criarProduto').length, 1);
  });

  await t.test('produto ja existente no Bling e vinculado pelo codigo (sem criar duplicado)', async () => {
    const id = await bling.criarProduto({ codigo: 'EXISTE-1', nome: 'Ja existia' });
    const r = await api('POST', '/admin/produtos', {
      token: operador,
      body: { nome: 'Outro', variacoes: [{ sku: 'EXISTE-1', preco: '10.00', peso_g: 100, altura_cm: 5, largura_cm: 5, comprimento_cm: 5 }] },
    });
    await ciclo();
    const [[v]] = await pool.query('SELECT bling_variacao_id b FROM produto_variacoes WHERE sku = ?', ['EXISTE-1']);
    assert.equal(String(v.b), id);
    assert.equal(r.status, 201);
  });

  await t.test('ajuste de estoque vai para o Bling como balanco', async () => {
    await api('PUT', `/admin/variacoes/${variacao.id}/estoque`, { token: operador, body: { saldo: 12 } });
    await ciclo();
    const [[v]] = await pool.query('SELECT bling_variacao_id b FROM produto_variacoes WHERE id = ?', [variacao.id]);
    assert.equal(bling.estado.saldos.get(String(v.b)), 12);
  });

  await t.test('falha transitoria: retry com backoff; permanente: vai para morto e pode reprocessar', async () => {
    bling.injetarFalha('transitorio', 'timeout simulado');
    await api('PUT', `/admin/variacoes/${variacao.id}`, { token: operador, body: { preco: '56.00' } });
    let r = await ciclo();
    assert.equal(r.erro, 1);
    let [item] = (await fila("status = 'erro'"));
    assert.equal(item.tentativas, 1);
    assert.match(item.ultimo_erro, /timeout simulado/);
    assert.ok(new Date(item.proxima_tentativa_em) > new Date(), 'backoff no futuro');

    r = await sync.executarCiclo(); // ainda em backoff: nada a fazer
    assert.equal(r.processados, 0);
    r = await ciclo();
    assert.equal(r.sucesso, 1);

    bling.injetarFalha('permanente', 'campo invalido');
    await api('PUT', `/admin/variacoes/${variacao.id}`, { token: operador, body: { preco: '57.00' } });
    r = await ciclo();
    assert.equal(r.morto, 1);
    [item] = await fila("status = 'morto'");
    assert.equal(item.tentativas, 1);

    assert.equal((await api('POST', `/admin/bling/fila/${item.id}/reprocessar`, { token: admin })).status, 204);
    r = await ciclo();
    assert.equal(r.sucesso, 1);
    assert.equal((await api('POST', `/admin/bling/fila/${item.id}/reprocessar`, { token: admin })).status, 409);
  });

  await t.test('esgota tentativas: vira morto apos MAX_TENTATIVAS', async () => {
    await api('PUT', `/admin/variacoes/${variacao.id}`, { token: operador, body: { preco: '58.00' } });
    for (let i = 0; i < sync.MAX_TENTATIVAS; i += 1) {
      bling.injetarFalha('transitorio', 'instavel');
      await ciclo();
    }
    const itens = await fila("status = 'morto'");
    assert.equal(itens.at(-1).tentativas, sync.MAX_TENTATIVAS);
    await pool.query("UPDATE bling_sync_fila SET status = 'sucesso' WHERE status = 'morto'");
  });

  await t.test('pedido pago: contato e pedido de venda criados no Bling, sem duplicar', async () => {
    const reg = await api('POST', '/auth/cliente/registrar', {
      body: { nome: 'Maria da Silva', email: 'maria@t.com', senha: 'Senha1234', cpf: '52998224725', telefone: '11912345678', aceite_termos: true },
    });
    const token = reg.body.access_token;
    const e = await api('POST', '/cliente/enderecos', { token, body: end });
    await api('POST', '/carrinho/itens', { token, body: { variacao_id: variacao.id, quantidade: 2 } });
    const co = await api('POST', '/pedidos', {
      token, body: { endereco_id: e.body.id, frete_servico: '1', pagamento: { metodo: 'cartao_credito', token: 'tok_ok1', payment_method_id: 'visa' } },
    });
    assert.equal(co.body.pedido.status, 'pago', JSON.stringify(co.body));

    await ciclo();
    assert.equal(bling.estado.pedidos.length, 1);
    const ped = bling.estado.pedidos[0].payload;
    assert.equal(ped.numeroLoja, co.body.pedido.numero);
    assert.equal(ped.itens[0].codigo, 'HID-1');
    assert.equal(ped.itens[0].quantidade, 2);
    assert.equal(ped.transporte.etiqueta.cep, '01310-100');
    assert.ok(bling.estado.contatos.has('52998224725'), 'contato criado pelo CPF decifrado');
    const [[p]] = await pool.query('SELECT bling_pedido_id b FROM pedidos');
    assert.ok(p.b);
    const [[c]] = await pool.query('SELECT bling_contato_id b FROM clientes');
    assert.ok(c.b);

    // reenfileirar nao cria pedido duplicado
    await pool.query("INSERT INTO bling_sync_fila (entidade, entidade_id, operacao) SELECT 'pedido', id, 'criar' FROM pedidos");
    await ciclo();
    assert.equal(bling.estado.pedidos.length, 1);
  });

  await t.test('webhook de estoque: busca o saldo real no Bling e aplica na loja (idempotente)', async () => {
    const [[v]] = await pool.query('SELECT bling_variacao_id b, estoque_disponivel d FROM produto_variacoes WHERE id = ?', [variacao.id]);
    const blingId = String(v.b);
    bling.estado.saldos.set(blingId, 40);
    const evento = { eventId: 'evt-1', event: 'stock.updated', data: { produto: { id: Number(blingId) }, saldoFisicoTotal: 999 } };
    const r1 = await api('POST', '/webhooks/bling', { body: evento });
    assert.equal(r1.status, 200);
    const [[depois]] = await pool.query('SELECT estoque_disponivel d FROM produto_variacoes WHERE id = ?', [variacao.id]);
    assert.equal(depois.d, 40, 'usa o saldo consultado na API, nao o do corpo do webhook');
    const [mov] = await pool.query("SELECT tipo, origem, saldo_apos FROM estoque_movimentacoes WHERE tipo = 'sync_bling'");
    assert.equal(mov.length, 1);
    assert.equal(mov[0].origem, 'bling');
    // nao gera eco para o Bling
    assert.equal((await fila("entidade = 'estoque' AND status = 'pendente'")).length, 0);

    // reentrega do mesmo evento e ignorada
    bling.estado.saldos.set(blingId, 7);
    assert.equal((await api('POST', '/webhooks/bling', { body: evento })).status, 200);
    assert.equal((await pool.query('SELECT estoque_disponivel d FROM produto_variacoes WHERE id = ?', [variacao.id]))[0][0].d, 40);

    // novo evento aplica o novo saldo
    assert.equal((await api('POST', '/webhooks/bling', { body: { ...evento, eventId: 'evt-2' } })).status, 200);
    assert.equal((await pool.query('SELECT estoque_disponivel d FROM produto_variacoes WHERE id = ?', [variacao.id]))[0][0].d, 7);
  });

  await t.test('webhook: produto sem SKU local, evento de outro tipo e JSON invalido nao quebram', async () => {
    assert.equal((await api('POST', '/webhooks/bling', { body: { eventId: 'x1', event: 'stock.updated', data: { produto: { id: 777777 } } } })).status, 200);
    assert.equal((await api('POST', '/webhooks/bling', { body: { eventId: 'x2', event: 'order.updated', data: {} } })).status, 200);
    assert.equal((await api('POST', '/webhooks/bling', { body: { eventId: 'x3', event: 'stock.updated' } })).status, 200);
    assert.equal((await api('POST', '/webhooks/bling', { body: '{ruim' })).status, 400);
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM bling_webhook_eventos WHERE processado_em IS NULL');
    assert.equal(Number(n), 0);
  });

  await t.test('falha ao consultar saldo deixa o evento pendente e o worker reprocessa', async () => {
    const [[v]] = await pool.query('SELECT bling_variacao_id b FROM produto_variacoes WHERE id = ?', [variacao.id]);
    bling.estado.saldos.set(String(v.b), 15);
    bling.injetarFalha('transitorio', 'bling fora do ar');
    assert.equal((await api('POST', '/webhooks/bling', { body: { eventId: 'evt-3', event: 'stock.updated', data: { produto: { id: Number(v.b) } } } })).status, 200);
    assert.equal((await pool.query("SELECT processado_em p FROM bling_webhook_eventos WHERE evento_id = 'evt-3'"))[0][0].p, null);
    await pool.query("UPDATE bling_webhook_eventos SET recebido_em = UTC_TIMESTAMP() - INTERVAL 5 MINUTE WHERE evento_id = 'evt-3'");
    assert.equal(await webhookSvc.processarPendentes(), 1);
    assert.equal((await pool.query('SELECT estoque_disponivel d FROM produto_variacoes WHERE id = ?', [variacao.id]))[0][0].d, 15);
  });

  await t.test('reconciliacao completa corrige divergencias', async () => {
    const [[v]] = await pool.query('SELECT bling_variacao_id b FROM produto_variacoes WHERE id = ?', [variacao.id]);
    bling.estado.saldos.set(String(v.b), 99);
    const r = await webhookSvc.sincronizarEstoqueCompleto();
    assert.ok(r.atualizadas >= 1);
    assert.equal((await pool.query('SELECT estoque_disponivel d FROM produto_variacoes WHERE id = ?', [variacao.id]))[0][0].d, 99);
    const http = await api('POST', '/admin/bling/sincronizar-estoque', { token: admin });
    assert.equal(http.status, 200);
  });

  await t.test('rotas admin: RBAC, status, fila e autorizacao no modo simulado', async () => {
    assert.equal((await api('GET', '/admin/bling/status', { token: operador })).status, 403);
    const st = await api('GET', '/admin/bling/status', { token: admin });
    assert.equal(st.status, 200);
    assert.equal(st.body.modo, 'simulado');
    assert.ok(st.body.fila.sucesso >= 1);
    const lista = await api('GET', '/admin/bling/fila?status=sucesso&limite=5', { token: admin });
    assert.equal(lista.body.itens.length, 5);
    assert.equal((await api('GET', '/admin/bling/autorizar', { token: admin })).status, 409);
    assert.equal((await api('GET', '/admin/dashboard')).status, 401);
    const dash = await api('GET', '/admin/dashboard', { token: operador });
    assert.equal(dash.status, 200);
    assert.equal(dash.body.pedidos_por_status.pago, 1);
  });

  await t.test('assinatura HMAC do webhook e validada sobre o corpo bruto', () => {
    const crypto = require('crypto');
    const corpo = Buffer.from('{"eventId":"1"}');
    const sig = `sha256=${crypto.createHmac('sha256', 'segredo').update(corpo).digest('hex')}`;
    assert.equal(webhookSvc.assinaturaValida(corpo, sig, 'segredo'), true);
    assert.equal(webhookSvc.assinaturaValida(Buffer.from('{"eventId":"2"}'), sig, 'segredo'), false);
    assert.equal(webhookSvc.assinaturaValida(corpo, 'sha256=00', 'segredo'), false);
    assert.equal(webhookSvc.assinaturaValida(corpo, undefined, 'segredo'), false);
  });

  await t.test('state do OAuth: valido, adulterado e expirado', () => {
    const auth = require('../src/integrations/bling/auth');
    assert.equal(auth.validarState('lixo'), false);
    assert.equal(auth.validarState(undefined), false);
    assert.equal(auth.validarState(`${Date.now()}.abc.${'0'.repeat(32)}`), false);
  });
});
