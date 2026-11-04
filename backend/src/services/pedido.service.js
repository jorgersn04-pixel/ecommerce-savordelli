'use strict';

const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { paraCentavos, deCentavos } = require('../utils/formatos');
const repo = require('../repositories/pedidos.repository');
const carrinhoRepo = require('../repositories/carrinho.repository');
const carrinhoService = require('./carrinho.service');
const clienteService = require('./cliente.service');
const cupons = require('./cupom.service');
const frete = require('./frete.service');
const estoque = require('./estoque.service');
const pagamentos = require('./pagamento.service');
const outbox = require('./bling-outbox.service');
const gateway = require('../integrations/mercadopago/client');
const { auditar } = require('./auditoria.service');

const TTL_SEM_BOLETO_MIN = 45;
const TTL_BOLETO_DIAS = 3;

const CPF_PRIVADO = ['cpf_cifrado'];
function semCpf(snapshot) {
  const copia = { ...snapshot };
  for (const k of CPF_PRIVADO) delete copia[k];
  return copia;
}

function nomeDoItem(l) {
  const attrs = l.atributos && typeof l.atributos === 'object' ? Object.values(l.atributos).join(' / ') : '';
  return (attrs ? `${l.nome} (${attrs})` : l.nome).slice(0, 250);
}

// ----------------------------------------------------------------- checkout
/**
 * Fecha a compra: valida carrinho/endereco/frete/cupom no servidor, reserva estoque,
 * grava o pedido com snapshots e inicia o pagamento. Nenhum valor monetario vem do cliente.
 */
async function criar(req, res, dados) {
  const clienteId = req.usuario.id;
  const carrinho = await carrinhoService.resolver(req, res);
  if (!carrinho) throw new AppError(422, 'CARRINHO_VAZIO', 'Sacola vazia');

  const itens = carrinhoService.montarItens(await carrinhoRepo.itens(pool, carrinho.id));
  if (itens.length === 0) throw new AppError(422, 'CARRINHO_VAZIO', 'Sacola vazia');
  const problema = itens.find((i) => i.problema);
  if (problema) {
    throw new AppError(409, 'ITENS_INDISPONIVEIS', 'Há itens indisponíveis no carrinho', {
      variacao_id: problema.variacao_id, problema: problema.problema,
    });
  }

  const endereco = await clienteService.buscarEndereco(pool, clienteId, dados.endereco_id);
  const resumo = await carrinhoService.calcularResumo(itens, dados.cupom);
  if (dados.cupom && !resumo.cupom.valido) throw new AppError(422, 'CUPOM_INVALIDO', resumo.cupom.motivo);

  // Cotacao externa fora da transacao (nao segura conexao nem locks).
  const opcaoFrete = await frete.cotarServico({
    cepDestino: endereco.cep,
    itens: itens.map((i) => i._frete),
    servico: dados.frete_servico,
    freteGratis: resumo.frete_gratis,
  });

  const [[cliente]] = await pool.execute(
    'SELECT nome, email, telefone, cpf_cifrado FROM clientes WHERE id = ? AND anonimizado_em IS NULL', [clienteId],
  );
  if (!cliente) throw new AppError(404, 'CLIENTE_NAO_ENCONTRADO', 'Cliente nao encontrado');
  const snapshotCliente = {
    cliente_id: String(clienteId), nome: cliente.nome, email: cliente.email, telefone: cliente.telefone,
    cpf_cifrado: cliente.cpf_cifrado ? Buffer.from(cliente.cpf_cifrado).toString('base64') : null,
  };
  const snapshotEndereco = {
    destinatario: endereco.destinatario, cep: endereco.cep, logradouro: endereco.logradouro, numero: endereco.numero,
    complemento: endereco.complemento, bairro: endereco.bairro, cidade: endereco.cidade, uf: endereco.uf,
  };

  const pedidoId = await withTransaction(async (conn) => {
    // Trava compartilhada no cliente: impede anonimizacao concorrente (LGPD) no meio do checkout.
    const [vivo] = await conn.execute('SELECT id FROM clientes WHERE id = ? AND anonimizado_em IS NULL FOR SHARE', [clienteId]);
    if (vivo.length === 0) throw new AppError(404, 'CLIENTE_NAO_ENCONTRADO', 'Cliente nao encontrado');

    // Serializa checkouts concorrentes do mesmo carrinho (duplo clique).
    const [[cart]] = await conn.execute('SELECT status FROM carrinhos WHERE id = ? FOR UPDATE', [carrinho.id]);
    if (!cart || cart.status !== 'aberto') throw new AppError(409, 'CARRINHO_JA_PROCESSADO', 'Esta sacola já foi finalizada');

    // Trava e reserva estoque; depois relê os precos sob o lock e confere com o que foi exibido.
    const reservas = await estoque.reservar(conn, itens.map((i) => ({ variacaoId: i.variacao_id, quantidade: i.quantidade })));
    const atuais = carrinhoService.montarItens(await carrinhoRepo.itens(conn, carrinho.id));
    const subtotalCent = atuais.reduce((s, i) => s + paraCentavos(i.preco_unitario) * i.quantidade, 0);
    if (subtotalCent !== paraCentavos(resumo.subtotal)) {
      throw new AppError(409, 'PRECO_ALTERADO', 'Os preços foram atualizados. Revise a sacola');
    }

    let descontoCent = 0;
    let cupomId = null;
    if (dados.cupom) {
      const v = await cupons.validar(dados.cupom, subtotalCent, { exec: conn, travar: true });
      if (v.descontoCent !== paraCentavos(resumo.desconto) || v.freteGratis !== resumo.frete_gratis) {
        throw new AppError(409, 'CUPOM_ALTERADO', 'O cupom foi alterado. Revise a sacola');
      }
      await cupons.consumir(conn, v.cupom.id);
      descontoCent = v.descontoCent;
      cupomId = v.cupom.id;
    }

    const totalCent = subtotalCent - descontoCent + paraCentavos(opcaoFrete.valor);
    const [r] = await conn.execute(
      `INSERT INTO pedidos (numero, cliente_id, cupom_id, subtotal, desconto, frete_valor, total,
                            snapshot_cliente, snapshot_endereco, frete_servico, frete_prazo_dias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `T${require('crypto').randomBytes(9).toString('hex')}`, clienteId, cupomId,
        deCentavos(subtotalCent), deCentavos(descontoCent), opcaoFrete.valor, deCentavos(totalCent),
        JSON.stringify(snapshotCliente), JSON.stringify(snapshotEndereco), opcaoFrete.nome, opcaoFrete.prazo_dias,
      ],
    );
    const id = String(r.insertId);
    const numero = `SV-${new Date().getUTCFullYear()}-${id.padStart(6, '0')}`;
    await conn.execute('UPDATE pedidos SET numero = ? WHERE id = ?', [numero, id]);

    for (const l of atuais) {
      await conn.execute(
        `INSERT INTO pedido_itens (pedido_id, variacao_id, sku, nome, quantidade, preco_unitario, total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, l.variacao_id, l.sku, nomeDoItem(l), l.quantidade, l.preco_unitario, l.total],
      );
    }
    await estoque.registrarReservas(conn, reservas, id);
    await repo.registrarHistorico(conn, id, null, 'aguardando_pagamento', `cliente:${clienteId}`, 'Pedido criado');
    await carrinhoRepo.marcarConvertido(conn, carrinho.id);
    return id;
  });

  const pedido = await repo.buscarPorId(pool, pedidoId);
  let pagamento;
  try {
    pagamento = await pagamentos.pagar(pedido, dados.pagamento);
  } catch (err) {
    // O pedido existe (estoque reservado); o cliente pode repetir via POST /pedidos/:numero/pagar.
    if (err instanceof AppError) {
      err.detalhes = { ...(err.detalhes || {}), pedido: pedido.numero };
    }
    throw err;
  }
  return { pedido: await detalhar(pedido.numero, clienteId), pagamento };
}

// ------------------------------------------------------------------ consulta
async function montarDetalhe(pedido, { admin = false } = {}) {
  const [itens, historico, pags, envios] = await Promise.all([
    repo.itens(pool, pedido.id),
    repo.historico(pool, pedido.id),
    repo.pagamentos(pool, pedido.id),
    repo.envios(pool, pedido.id),
  ]);
  return {
    ...(admin ? { id: String(pedido.id) } : {}),
    numero: pedido.numero,
    status: pedido.status,
    subtotal: pedido.subtotal,
    desconto: pedido.desconto,
    frete: { servico: pedido.frete_servico, prazo_dias: pedido.frete_prazo_dias, valor: pedido.frete_valor },
    total: pedido.total,
    criado_em: pedido.criado_em,
    cliente: semCpf(pedido.snapshot_cliente),
    endereco_entrega: pedido.snapshot_endereco,
    itens,
    pagamentos: pags.map((p) => ({
      metodo: p.metodo, status: p.status, valor: p.valor, parcelas: p.parcelas, pago_em: p.pago_em, criado_em: p.criado_em,
      ...(admin ? { id: String(p.id), provedor_transacao_id: p.provedor_transacao_id } : {}),
    })),
    envios,
    historico: historico.map((h) => ({
      status: h.status_para,
      criado_em: h.criado_em,
      ...(admin ? { de: h.status_de, autor: h.autor, observacao: h.observacao } : {}),
    })),
    ...(admin ? { bling_pedido_id: pedido.bling_pedido_id } : {}),
  };
}

async function detalhar(numero, clienteId) {
  const pedido = await repo.buscarPorNumero(pool, numero, clienteId);
  if (!pedido) throw new AppError(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado');
  return montarDetalhe(pedido);
}

async function listarDoCliente(clienteId, filtros) {
  const { total, itens } = await repo.listarDoCliente(clienteId, filtros);
  return {
    itens: itens.map((i) => ({ ...i, quantidade_itens: Number(i.quantidade_itens) })),
    paginacao: { pagina: filtros.pagina, limite: filtros.limite, total, paginas: Math.ceil(total / filtros.limite) },
  };
}

async function pagarPedido(numero, clienteId, dadosPagamento) {
  const pedido = await repo.buscarPorNumero(pool, numero, clienteId);
  if (!pedido) throw new AppError(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado');
  const pagamento = await pagamentos.pagar(pedido, dadosPagamento);
  return { pedido: await detalhar(numero, clienteId), pagamento };
}

async function pagamentoDoPedido(numero, clienteId) {
  const pedido = await repo.buscarPorNumero(pool, numero, clienteId);
  if (!pedido) throw new AppError(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado');
  return { status_pedido: (await repo.buscarPorId(pool, pedido.id)).status, pagamento: await pagamentos.situacaoAtual(pedido) };
}

// ------------------------------------------------------------- cancelamento
/**
 * Cancela pedido que ainda aguarda pagamento: devolve reserva e uso do cupom e encerra
 * pagamentos pendentes. Deve rodar em transacao. Retorna ids de transacao a cancelar no gateway.
 */
async function cancelarAguardando(conn, pedidoId, autor, observacao) {
  const pedido = await repo.buscarPorId(conn, pedidoId, true);
  if (!pedido || pedido.status !== 'aguardando_pagamento') return null;

  await conn.execute("UPDATE pedidos SET status = 'cancelado' WHERE id = ?", [pedidoId]);
  await estoque.liberarReserva(conn, pedidoId);
  if (pedido.cupom_id) await cupons.devolver(conn, pedido.cupom_id);
  const [pend] = await conn.execute(
    "SELECT provedor_transacao_id FROM pagamentos WHERE pedido_id = ? AND status = 'pendente'", [pedidoId],
  );
  await conn.execute("UPDATE pagamentos SET status = 'expirado' WHERE pedido_id = ? AND status = 'pendente'", [pedidoId]);
  await repo.registrarHistorico(conn, pedidoId, 'aguardando_pagamento', 'cancelado', autor, observacao);
  return pend.map((p) => p.provedor_transacao_id).filter(Boolean);
}

async function cancelarPeloCliente(numero, clienteId) {
  const pedido = await repo.buscarPorNumero(pool, numero, clienteId);
  if (!pedido) throw new AppError(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado');
  const transacoes = await withTransaction((conn) =>
    cancelarAguardando(conn, pedido.id, `cliente:${clienteId}`, 'Cancelado pelo cliente'));
  if (transacoes === null) {
    throw new AppError(409, 'PEDIDO_NAO_CANCELAVEL', 'Só é possível cancelar pedidos que aguardam pagamento');
  }
  for (const t of transacoes) gateway.cancelarPagamento(t);
  return detalhar(numero, clienteId);
}

/** Job: cancela pedidos que nao foram pagos no prazo (pix/cartao 45 min; boleto 3 dias). */
async function expirarPendentes() {
  const [rows] = await pool.execute(
    `SELECT p.id FROM pedidos p
      WHERE p.status = 'aguardando_pagamento'
        AND TIMESTAMPDIFF(MINUTE, p.criado_em, UTC_TIMESTAMP()) > IF(
              EXISTS (SELECT 1 FROM pagamentos g WHERE g.pedido_id = p.id AND g.metodo = 'boleto' AND g.status = 'pendente'),
              ${TTL_BOLETO_DIAS * 1440}, ${TTL_SEM_BOLETO_MIN})`,
  );
  let expirados = 0;
  for (const { id } of rows) {
    const transacoes = await withTransaction((conn) => cancelarAguardando(conn, id, 'sistema', 'Expirado por falta de pagamento'));
    if (transacoes) {
      expirados += 1;
      for (const t of transacoes) gateway.cancelarPagamento(t);
    }
  }
  return expirados;
}

// -------------------------------------------------------------------- admin
const TRANSICOES = {
  aguardando_pagamento: ['cancelado'],
  pago: ['em_separacao', 'cancelado'],
  em_separacao: ['enviado', 'cancelado'],
  enviado: ['entregue'],
  entregue: ['reembolsado'],
  cancelado: ['reembolsado'],
  reembolsado: [],
};

async function listarAdmin(filtros) {
  const { total, itens } = await repo.listarAdmin(filtros);
  return {
    itens,
    paginacao: { pagina: filtros.pagina, limite: filtros.limite, total, paginas: Math.ceil(total / filtros.limite) },
  };
}

async function detalharAdmin(req, id) {
  const pedido = await repo.buscarPorId(pool, id);
  if (!pedido) throw new AppError(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado');
  await auditar(null, req, 'pedido.visualizar', 'pedido', id); // acesso a dados pessoais do titular
  return montarDetalhe(pedido, { admin: true });
}

async function atualizarStatusAdmin(req, id, { status, observacao, codigo_rastreio: rastreio }) {
  let transacoes = [];
  await withTransaction(async (conn) => {
    const pedido = await repo.buscarPorId(conn, id, true);
    if (!pedido) throw new AppError(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado');
    if (!TRANSICOES[pedido.status].includes(status)) {
      throw new AppError(409, 'TRANSICAO_INVALIDA', `Nao e possivel ir de "${pedido.status}" para "${status}"`, {
        permitidas: TRANSICOES[pedido.status],
      });
    }
    const autor = `admin:${req.usuario.id}`;

    if (status === 'cancelado' && pedido.status === 'aguardando_pagamento') {
      transacoes = await cancelarAguardando(conn, id, autor, observacao ?? 'Cancelado pelo administrador');
    } else {
      await conn.execute('UPDATE pedidos SET status = ? WHERE id = ?', [status, id]);
      if (status === 'cancelado') {
        // Pedido pago: devolve ao estoque e sinaliza reembolso pendente.
        await estoque.devolverAoEstoque(conn, id);
        if (pedido.cupom_id) await cupons.devolver(conn, pedido.cupom_id);
        observacao = `${observacao ?? 'Cancelado pelo administrador'} - reembolso pendente`;
      }
      if (status === 'enviado') {
        await conn.execute(
          "INSERT INTO envios (pedido_id, servico, codigo_rastreio, status, postado_em) VALUES (?, ?, ?, 'postado', UTC_TIMESTAMP())",
          [id, pedido.frete_servico ?? 'N/D', rastreio ?? null],
        );
      }
      if (status === 'entregue') {
        await conn.execute("UPDATE envios SET status = 'entregue', entregue_em = UTC_TIMESTAMP() WHERE pedido_id = ?", [id]);
      }
      await repo.registrarHistorico(conn, id, pedido.status, status, autor, observacao ?? null);
      await outbox.enfileirar(conn, 'pedido', id, 'atualizar', { numero: pedido.numero, status });
    }
    await auditar(conn, req, 'pedido.status', 'pedido', id, { de: pedido.status, para: status });
  });
  for (const t of transacoes || []) gateway.cancelarPagamento(t);
  return montarDetalhe(await repo.buscarPorId(pool, id), { admin: true });
}

module.exports = {
  criar, detalhar, listarDoCliente, pagarPedido, pagamentoDoPedido, cancelarPeloCliente,
  expirarPendentes, listarAdmin, detalharAdmin, atualizarStatusAdmin,
};
