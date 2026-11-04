'use strict';

const { habilitado, iniciar } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

test('catalogo (integracao)', { skip: !habilitado && 'defina SV_TEST_DB=1' }, async (t) => {
  const ctx = await iniciar();
  const { api, criarAdmin, pool } = ctx;
  t.after(() => ctx.encerrar());

  const admin = await criarAdmin('admin@t.com', 'admin');
  const financeiro = await criarAdmin('fin@t.com', 'financeiro');
  const operador = await criarAdmin('op@t.com', 'operador');

  const variacao = (sku, preco, extra = {}) => ({
    sku, preco, peso_g: 300, altura_cm: 10, largura_cm: 8, comprimento_cm: 8, atributos: { volume_ml: 50 }, ...extra,
  });

  let marcaId;
  let categoriaId;
  let produto;

  await t.test('RBAC: financeiro nao cria produto, sem token nao lista', async () => {
    assert.equal((await api('POST', '/admin/marcas', { token: financeiro, body: { nome: 'X' } })).status, 403);
    assert.equal((await api('GET', '/admin/produtos')).status, 401);
    assert.equal((await api('GET', '/admin/produtos', { token: financeiro })).status, 403);
  });

  await t.test('marca e categoria', async () => {
    const m = await api('POST', '/admin/marcas', { token: operador, body: { nome: 'Quem Disse, Berenice?' } });
    assert.equal(m.status, 201);
    assert.equal(m.body.slug, 'quem-disse-berenice');
    marcaId = m.body.id;
    const c = await api('POST', '/admin/categorias', { token: operador, body: { nome: 'Maquiagem' } });
    assert.equal(c.status, 201);
    categoriaId = c.body.id;
    const filha = await api('POST', '/admin/categorias', { token: operador, body: { nome: 'Batom', pai_id: categoriaId } });
    assert.equal(filha.status, 201);
  });

  await t.test('cria produto com variacoes, categorias e imagens', async () => {
    const r = await api('POST', '/admin/produtos', {
      token: operador,
      body: {
        nome: 'Batom Matte Rosa', marca_id: marcaId, status: 'ativo', categorias_ids: [categoriaId],
        descricao_curta: 'Batom de longa duracao',
        variacoes: [variacao('BAT-001', 39.9, { preco_promocional: 29.9 }), variacao('BAT-002', '45.00')],
        imagens: [{ url: 'https://cdn.exemplo.com/a.jpg' }, { url: 'https://cdn.exemplo.com/b.jpg' }],
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    produto = r.body;
    assert.equal(produto.slug, 'batom-matte-rosa');
    assert.equal(produto.variacoes.length, 2);
    assert.equal(produto.imagens.filter((i) => i.principal).length, 1);
    const [fila] = await pool.query("SELECT * FROM bling_sync_fila WHERE entidade='produto' AND operacao='criar'");
    assert.equal(fila.length, 1);
    const [aud] = await pool.query("SELECT * FROM logs_auditoria WHERE acao='produto.criar'");
    assert.equal(aud.length, 1);
  });

  await t.test('validacoes e conflitos', async () => {
    const dup = await api('POST', '/admin/produtos', { token: operador, body: { nome: 'Outro', variacoes: [variacao('BAT-001', 10)] } });
    assert.equal(dup.status, 409);
    const promoRuim = await api('POST', '/admin/produtos', {
      token: operador, body: { nome: 'Y', variacoes: [variacao('Z1', 10, { preco_promocional: 20 })] },
    });
    assert.equal(promoRuim.status, 400);
    const semVar = await api('POST', '/admin/produtos', { token: operador, body: { nome: 'Sem variacao', variacoes: [] } });
    assert.equal(semVar.status, 400);
  });

  await t.test('vitrine: sem estoque nao esta disponivel, depois do ajuste esta', async () => {
    let l = await api('GET', '/catalogo/produtos');
    assert.equal(l.status, 200);
    assert.equal(l.body.itens.length, 1);
    assert.equal(l.body.itens[0].disponivel, false);
    assert.equal(l.body.itens[0].preco_min, '29.90');
    assert.equal(l.body.itens[0].preco_cheio_min, '39.90');

    const v = produto.variacoes[0];
    assert.equal((await api('PUT', `/admin/variacoes/${v.id}/estoque`, { token: operador, body: { saldo: 10 } })).status, 200);
    l = await api('GET', '/catalogo/produtos');
    assert.equal(l.body.itens[0].disponivel, true);
    const [mov] = await pool.query("SELECT * FROM estoque_movimentacoes WHERE tipo='ajuste'");
    assert.equal(mov.length, 1);
  });

  await t.test('filtros: busca, marca, categoria pai (inclui filha), ordenacao', async () => {
    assert.equal((await api('GET', '/catalogo/produtos?q=batom')).body.itens.length, 1);
    assert.equal((await api('GET', '/catalogo/produtos?q=zzzz')).body.itens.length, 0);
    assert.equal((await api('GET', '/catalogo/produtos?marca=quem-disse-berenice')).body.itens.length, 1);
    assert.equal((await api('GET', '/catalogo/produtos?categoria=maquiagem')).body.itens.length, 1);
    assert.equal((await api('GET', '/catalogo/produtos?categoria=inexistente')).body.itens.length, 0);
    assert.equal((await api('GET', '/catalogo/produtos?ordem=preco_asc')).status, 200);
    assert.equal((await api('GET', '/catalogo/produtos?ordem=hack')).status, 400);
    assert.equal((await api('GET', '/catalogo/produtos?q=100%25')).status, 200);
  });

  await t.test('detalhe publico nao vaza custo nem reservado', async () => {
    const r = await api('GET', '/catalogo/produtos/batom-matte-rosa');
    assert.equal(r.status, 200);
    assert.equal(r.body.variacoes.length, 2);
    assert.ok(!('custo' in r.body.variacoes[0]));
    assert.ok(!('estoque_reservado' in r.body.variacoes[0]));
    assert.equal(r.body.variacoes[0].disponivel, 10);
    assert.equal((await api('GET', '/catalogo/produtos/nao-existe')).status, 404);
  });

  await t.test('rascunho e excluido nao aparecem na vitrine', async () => {
    const r = await api('POST', '/admin/produtos', { token: operador, body: { nome: 'Rascunho', variacoes: [variacao('R-1', 5)] } });
    assert.equal((await api('GET', `/catalogo/produtos/${r.body.slug}`)).status, 404);
    assert.equal((await api('DELETE', `/admin/produtos/${produto.id}`, { token: admin })).status, 204);
    assert.equal((await api('GET', '/catalogo/produtos')).body.itens.length, 0);
    assert.equal((await api('GET', `/admin/produtos/${produto.id}`, { token: admin })).status, 404);
  });

  await t.test('produto ativo exige variacao ativa', async () => {
    const r = await api('POST', '/admin/produtos', {
      token: operador, body: { nome: 'Inativo', status: 'ativo', variacoes: [variacao('I-1', 5, { ativo: false })] },
    });
    assert.equal(r.status, 422);
  });

  await t.test('marcas e categorias: contagem, exclusao segura e protecao contra ciclos', async () => {
    const m = await api('POST', '/admin/marcas', { token: operador, body: { nome: 'Marca Temp' } });
    const sem = await api('POST', '/admin/marcas', { token: operador, body: { nome: 'Sem Produtos' } });
    const p = await api('POST', '/admin/produtos', {
      token: operador, body: { nome: 'Com marca', marca_id: m.body.id, variacoes: [variacao('MT-1', 9)] },
    });
    assert.equal(p.status, 201);

    const lista = (await api('GET', '/admin/marcas', { token: operador })).body.itens;
    assert.equal(lista.find((x) => x.id === m.body.id).produtos, 1);
    assert.equal(lista.find((x) => x.id === sem.body.id).produtos, 0);

    const emUso = await api('DELETE', `/admin/marcas/${m.body.id}`, { token: admin });
    assert.equal(emUso.status, 409);
    assert.equal(emUso.body.erro.codigo, 'MARCA_EM_USO');
    assert.equal((await api('DELETE', `/admin/marcas/${sem.body.id}`, { token: operador })).status, 204);
    assert.equal((await api('DELETE', `/admin/marcas/${sem.body.id}`, { token: admin })).status, 404);
    assert.equal((await api('DELETE', `/admin/marcas/${m.body.id}`, { token: financeiro })).status, 403);

    const a = await api('POST', '/admin/categorias', { token: operador, body: { nome: 'Nivel A' } });
    const b = await api('POST', '/admin/categorias', { token: operador, body: { nome: 'Nivel B', pai_id: a.body.id } });
    const c = await api('POST', '/admin/categorias', { token: operador, body: { nome: 'Nivel C', pai_id: b.body.id } });
    // A sob C formaria o ciclo A -> B -> C -> A
    const ciclo = await api('PUT', `/admin/categorias/${a.body.id}`, { token: operador, body: { nome: 'Nivel A', pai_id: c.body.id } });
    assert.equal(ciclo.status, 422);
    assert.equal(ciclo.body.erro.codigo, 'CATEGORIA_CICLICA');
    assert.equal((await api('PUT', `/admin/categorias/${a.body.id}`, { token: operador, body: { nome: 'Nivel A', pai_id: a.body.id } })).status, 422);

    await api('PUT', `/admin/produtos/${p.body.id}`, { token: operador, body: { categorias_ids: [b.body.id] } });
    const cats = (await api('GET', '/admin/categorias', { token: operador })).body.itens;
    assert.equal(cats.find((x) => x.id === b.body.id).produtos, 1);
    assert.equal((await api('DELETE', `/admin/categorias/${b.body.id}`, { token: admin })).body.erro.codigo, 'CATEGORIA_EM_USO');

    // C nao tem produtos: exclui; depois libera B e exclui tambem
    assert.equal((await api('DELETE', `/admin/categorias/${c.body.id}`, { token: admin })).status, 204);
    await api('PUT', `/admin/produtos/${p.body.id}`, { token: operador, body: { categorias_ids: [] } });
    assert.equal((await api('DELETE', `/admin/categorias/${b.body.id}`, { token: admin })).status, 204);
    const [[aud]] = await pool.query("SELECT COUNT(*) n FROM logs_auditoria WHERE acao IN ('marca.excluir', 'categoria.excluir')");
    assert.equal(Number(aud.n), 3);
  });
});
