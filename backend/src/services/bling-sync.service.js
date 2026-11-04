'use strict';

const { pool, withTransaction } = require('../config/db');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');
const { decifrar } = require('../utils/crypto');
const bling = require('../integrations/bling');
const pedidosRepo = require('../repositories/pedidos.repository');

const MAX_TENTATIVAS = 6;
const LOTE = 10;
const PROCESSANDO_EXPIRA_MIN = 10;

async function um(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows[0] ?? null;
}

const semNulos = (o) => JSON.parse(JSON.stringify(o, (_k, v) => (v === null || v === undefined || v === '' ? undefined : v)));
const kg = (g) => Number((g / 1000).toFixed(3));
const cepFmt = (c) => `${String(c).slice(0, 5)}-${String(c).slice(5)}`;

// ------------------------------------------------------------ produtos
function nomeBling(produto, v) {
  const attrs = v.atributos && typeof v.atributos === 'object'
    ? Object.values(typeof v.atributos === 'string' ? JSON.parse(v.atributos) : v.atributos).join(' / ')
    : '';
  return (attrs ? `${produto.nome} - ${attrs}` : produto.nome).slice(0, 120);
}

/**
 * Cada variacao (SKU) vira um produto simples no Bling (formato "S"), casado pelo `codigo` = SKU.
 * Isso mantem o saldo por SKU e evita o modelo de variacoes do Bling.
 */
function montarProdutoBling(produto, v, { marca, imagens, blingCategoriaId }) {
  const ativo = produto.status === 'ativo' && !produto.excluido_em && v.ativo;
  return semNulos({
    nome: nomeBling(produto, v),
    codigo: v.sku,
    tipo: 'P',
    formato: 'S',
    situacao: ativo ? 'A' : 'I',
    unidade: 'UN',
    preco: Number(v.preco),
    descricaoCurta: produto.descricao_curta,
    gtin: v.ean,
    marca,
    pesoLiquido: kg(v.peso_g),
    pesoBruto: kg(v.peso_g),
    dimensoes: {
      largura: Number(v.largura_cm), altura: Number(v.altura_cm), profundidade: Number(v.comprimento_cm), unidadeMedida: 1,
    },
    tributacao: { ncm: produto.ncm, origem: produto.origem_fiscal },
    categoria: blingCategoriaId ? { id: Number(blingCategoriaId) } : undefined,
    midia: imagens.length ? { imagens: { externas: imagens.map((i) => ({ link: i.url })) } } : undefined,
  });
}

async function carregarProduto(produtoId) {
  const produto = await um('SELECT * FROM produtos WHERE id = ?', [produtoId]);
  if (!produto) return null;
  const [variacoes] = await pool.execute('SELECT * FROM produto_variacoes WHERE produto_id = ? ORDER BY id', [produtoId]);
  const m = produto.marca_id ? await um('SELECT nome FROM marcas WHERE id = ?', [produto.marca_id]) : null;
  const [imagens] = await pool.execute('SELECT url FROM produto_imagens WHERE produto_id = ? ORDER BY principal DESC, ordem, id', [produtoId]);
  const [cats] = await pool.execute(
    `SELECT c.bling_categoria_id FROM produto_categorias pc JOIN categorias c ON c.id = pc.categoria_id
      WHERE pc.produto_id = ? AND c.bling_categoria_id IS NOT NULL LIMIT 1`, [produtoId],
  );
  return { produto, variacoes, extras: { marca: m?.nome, imagens, blingCategoriaId: cats[0]?.bling_categoria_id } };
}

async function sincronizarProduto(produtoId) {
  const dados = await carregarProduto(produtoId);
  if (!dados) throw Object.assign(new AppError(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto nao existe mais'), { permanente: true });
  const { produto, variacoes, extras } = dados;

  for (const v of variacoes) {
    const payload = montarProdutoBling(produto, v, extras);
    let id = v.bling_variacao_id ? String(v.bling_variacao_id) : await bling.buscarProdutoPorCodigo(v.sku);
    if (id) await bling.atualizarProduto(id, payload);
    else id = await bling.criarProduto(payload);
    if (String(v.bling_variacao_id) !== id) {
      await pool.execute('UPDATE produto_variacoes SET bling_variacao_id = ? WHERE id = ?', [id, v.id]);
    }
  }
  return `${variacoes.length} variacao(oes) sincronizada(s)`;
}

async function inativarProduto(produtoId) {
  const [vars] = await pool.execute('SELECT bling_variacao_id FROM produto_variacoes WHERE produto_id = ? AND bling_variacao_id IS NOT NULL', [produtoId]);
  for (const v of vars) await bling.inativarProduto(String(v.bling_variacao_id));
  return `${vars.length} produto(s) inativado(s) no Bling`;
}

// -------------------------------------------------------------- estoque
async function enviarEstoque(variacaoId, saldo) {
  let v = await um('SELECT id, produto_id, bling_variacao_id FROM produto_variacoes WHERE id = ?', [variacaoId]);
  if (!v) throw Object.assign(new AppError(404, 'VARIACAO_NAO_ENCONTRADA', 'Variacao nao existe mais'), { permanente: true });
  if (!v.bling_variacao_id) {
    await sincronizarProduto(v.produto_id);
    v = await um('SELECT bling_variacao_id FROM produto_variacoes WHERE id = ?', [variacaoId]);
  }
  await bling.lancarSaldo({ produtoId: String(v.bling_variacao_id), quantidade: saldo, observacao: 'Ajuste manual no painel da loja' });
  return `saldo ${saldo} enviado`;
}

// --------------------------------------------------------------- pedidos
async function garantirContato(snapshot, endereco) {
  const cpf = snapshot.cpf_cifrado ? decifrar(Buffer.from(snapshot.cpf_cifrado, 'base64')) : null;
  if (snapshot.cliente_id) {
    const c = await um('SELECT bling_contato_id FROM clientes WHERE id = ?', [snapshot.cliente_id]);
    if (c?.bling_contato_id) return String(c.bling_contato_id);
  }
  let id = cpf ? await bling.buscarContatoPorDocumento(cpf) : null;
  if (!id) {
    id = await bling.criarContato(semNulos({
      nome: snapshot.nome,
      tipo: 'F',
      numeroDocumento: cpf,
      email: snapshot.email,
      celular: snapshot.telefone,
      situacao: 'A',
      endereco: {
        geral: {
          endereco: endereco.logradouro, numero: endereco.numero, complemento: endereco.complemento,
          bairro: endereco.bairro, cep: cepFmt(endereco.cep), municipio: endereco.cidade, uf: endereco.uf,
        },
      },
    }));
  }
  if (snapshot.cliente_id) await pool.execute('UPDATE clientes SET bling_contato_id = ? WHERE id = ?', [id, snapshot.cliente_id]);
  return id;
}

async function enviarPedido(pedidoId) {
  const p = await pedidosRepo.buscarPorId(pool, pedidoId);
  if (!p) throw Object.assign(new AppError(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido nao existe mais'), { permanente: true });
  if (p.bling_pedido_id) return 'pedido ja enviado ao Bling';

  const itens = await pedidosRepo.itens(pool, pedidoId);
  const e = p.snapshot_endereco;
  const contatoId = await garantirContato(p.snapshot_cliente, e);

  const id = await bling.criarPedidoVenda(semNulos({
    numeroLoja: p.numero,
    data: new Date(p.criado_em).toISOString().slice(0, 10),
    contato: { id: Number(contatoId) },
    itens: itens.map((i) => ({ codigo: i.sku, descricao: i.nome, quantidade: i.quantidade, valor: Number(i.preco_unitario) })),
    desconto: Number(p.desconto) > 0 ? { valor: Number(p.desconto), unidade: 'REAL' } : undefined,
    transporte: {
      frete: Number(p.frete_valor),
      fretePorConta: 0,
      contato: { nome: e.destinatario },
      etiqueta: {
        nome: e.destinatario, endereco: e.logradouro, numero: e.numero, complemento: e.complemento,
        bairro: e.bairro, municipio: e.cidade, uf: e.uf, cep: cepFmt(e.cep), nomePais: 'BRASIL',
      },
    },
    observacoes: `Pedido ${p.numero} (loja online) - ${p.frete_servico ?? 'frete'}`,
  }));
  await pool.execute('UPDATE pedidos SET bling_pedido_id = ? WHERE id = ?', [id, pedidoId]);
  return `pedido criado no Bling (${id})`;
}

// ------------------------------------------------------------------ fila
async function processar(item) {
  const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
  const chave = `${item.entidade}:${item.operacao}`;
  switch (chave) {
    case 'produto:criar':
    case 'produto:atualizar':
      return sincronizarProduto(item.entidade_id);
    case 'produto:excluir':
      return inativarProduto(item.entidade_id);
    case 'estoque:atualizar':
      return enviarEstoque(item.entidade_id, payload?.saldo);
    case 'pedido:criar':
      return enviarPedido(item.entidade_id);
    case 'pedido:atualizar':
      return 'atualizacao de status de pedido ainda nao mapeada para o Bling';
    default:
      throw Object.assign(new AppError(422, 'OPERACAO_NAO_SUPORTADA', `Operacao nao suportada: ${chave}`), { permanente: true });
  }
}

/** Reserva um lote da fila sem disputa entre workers (SKIP LOCKED). */
async function reservarLote(limite = LOTE) {
  return withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE bling_sync_fila SET status = 'erro'
        WHERE status = 'processando' AND proxima_tentativa_em < UTC_TIMESTAMP() - INTERVAL ${PROCESSANDO_EXPIRA_MIN} MINUTE`,
    );
    const [ids] = await conn.query(
      `SELECT id FROM bling_sync_fila
        WHERE status IN ('pendente', 'erro') AND proxima_tentativa_em <= UTC_TIMESTAMP()
        ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`,
      [limite],
    );
    if (ids.length === 0) return [];
    await conn.query(
      "UPDATE bling_sync_fila SET status = 'processando', proxima_tentativa_em = UTC_TIMESTAMP() WHERE id IN (?)",
      [ids.map((r) => r.id)],
    );
    const [itens] = await conn.query('SELECT * FROM bling_sync_fila WHERE id IN (?) ORDER BY id', [ids.map((r) => r.id)]);
    return itens;
  });
}

async function registrarLog(item, ms, resumo) {
  await pool.execute(
    'INSERT INTO bling_sync_logs (fila_id, direcao, endpoint, duracao_ms, resumo) VALUES (?, ?, ?, ?, ?)',
    [item.id, 'saida', `${item.entidade}.${item.operacao}`, ms, String(resumo).slice(0, 500)],
  );
}

async function concluir(item, inicio) {
  try {
    const resumo = await processar(item);
    await pool.execute("UPDATE bling_sync_fila SET status = 'sucesso', tentativas = tentativas + 1, ultimo_erro = NULL WHERE id = ?", [item.id]);
    await registrarLog(item, Date.now() - inicio, resumo);
    return 'sucesso';
  } catch (err) {
    const tentativas = item.tentativas + 1;
    const morto = err.permanente || tentativas >= MAX_TENTATIVAS;
    const minutos = Math.min(2 ** tentativas, 60);
    await pool.execute(
      `UPDATE bling_sync_fila SET status = ?, tentativas = ?, ultimo_erro = ?,
              proxima_tentativa_em = UTC_TIMESTAMP() + INTERVAL ? MINUTE WHERE id = ?`,
      [morto ? 'morto' : 'erro', tentativas, String(err.message).slice(0, 2000), minutos, item.id],
    );
    await registrarLog(item, Date.now() - inicio, `FALHA (${morto ? 'definitiva' : `tentativa ${tentativas}`}): ${err.message}`);
    logger.warn({ fila: item.id, entidade: item.entidade, operacao: item.operacao, morto, erro: err.message }, 'bling: item falhou');
    return morto ? 'morto' : 'erro';
  }
}

/** Um ciclo do worker: processa ate `LOTE` itens em ordem de criacao. */
async function executarCiclo() {
  if (!bling.configurado && require('../config/env').isProd) return { processados: 0 };
  const itens = await reservarLote();
  const r = { processados: itens.length, sucesso: 0, erro: 0, morto: 0 };
  // Sequencial de proposito: preserva a ordem de criacao (produto antes de estoque e pedido).
  for (const item of itens) {
    r[await concluir(item, Date.now())] += 1;
  }
  return r;
}

async function reprocessar(filaId) {
  const [r] = await pool.execute(
    `UPDATE bling_sync_fila SET status = 'pendente', tentativas = 0, ultimo_erro = NULL,
            proxima_tentativa_em = UTC_TIMESTAMP() WHERE id = ? AND status IN ('erro', 'morto')`,
    [filaId],
  );
  if (r.affectedRows === 0) throw new AppError(409, 'FILA_NAO_REPROCESSAVEL', 'Somente itens com erro ou mortos podem ser reprocessados');
}

module.exports = { executarCiclo, reservarLote, reprocessar, montarProdutoBling, MAX_TENTATIVAS };
