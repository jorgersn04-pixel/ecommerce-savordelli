'use strict';

const AppError = require('../utils/AppError');
const { withTransaction } = require('../config/db');
const outbox = require('./bling-outbox.service');

async function travarVariacao(conn, id) {
  const [rows] = await conn.execute(
    'SELECT id, estoque_disponivel, estoque_reservado, bling_variacao_id FROM produto_variacoes WHERE id = ? FOR UPDATE',
    [id],
  );
  if (!rows[0]) throw new AppError(404, 'VARIACAO_NAO_ENCONTRADA', 'Variacao nao encontrada');
  return rows[0];
}

async function registrar(conn, { variacaoId, tipo, quantidade, saldoApos, pedidoId = null, origem }) {
  await conn.execute(
    `INSERT INTO estoque_movimentacoes (variacao_id, tipo, quantidade, saldo_apos, pedido_id, origem)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [variacaoId, tipo, quantidade, saldoApos, pedidoId, origem],
  );
}

/**
 * Ajuste manual no admin. O Bling e a fonte absoluta: o ajuste vai para o outbox e
 * sera sobrescrito pelo saldo que o Bling devolver na proxima sincronizacao.
 */
async function ajustarSaldoAdmin(variacaoId, saldo) {
  return withTransaction(async (conn) => {
    const v = await travarVariacao(conn, variacaoId);
    if (saldo < v.estoque_reservado) {
      throw new AppError(409, 'SALDO_MENOR_QUE_RESERVADO', `Saldo nao pode ser menor que o reservado (${v.estoque_reservado})`);
    }
    await conn.execute('UPDATE produto_variacoes SET estoque_disponivel = ? WHERE id = ?', [saldo, variacaoId]);
    await registrar(conn, {
      variacaoId, tipo: 'ajuste', quantidade: saldo - v.estoque_disponivel, saldoApos: saldo, origem: 'admin',
    });
    await outbox.enfileirar(conn, 'estoque', variacaoId, 'atualizar', {
      variacao_id: variacaoId, bling_variacao_id: v.bling_variacao_id, saldo,
    });
    return { variacao_id: String(variacaoId), estoque_disponivel: saldo, estoque_reservado: v.estoque_reservado };
  });
}

/** Chamado pelo sincronizador do Bling (webhook/polling): o saldo do Bling prevalece. */
async function aplicarSaldoBling(variacaoId, saldo) {
  return withTransaction(async (conn) => {
    const v = await travarVariacao(conn, variacaoId);
    await conn.execute('UPDATE produto_variacoes SET estoque_disponivel = ? WHERE id = ?', [saldo, variacaoId]);
    await registrar(conn, {
      variacaoId, tipo: 'sync_bling', quantidade: saldo - v.estoque_disponivel, saldoApos: saldo, origem: 'bling',
    });
  });
}

/**
 * Trava e reserva os itens dentro da transacao do checkout (ordem de id evita deadlock).
 * itens: [{ variacaoId, quantidade }]. Devolve os dados para registrarReservas(), chamado
 * depois que o pedido existe (a movimentacao precisa do pedido_id).
 */
async function reservar(conn, itens) {
  const ordenados = [...itens].sort((a, b) => Number(a.variacaoId) - Number(b.variacaoId));
  const reservas = [];
  for (const it of ordenados) {
    const v = await travarVariacao(conn, it.variacaoId);
    const livre = v.estoque_disponivel - v.estoque_reservado;
    if (livre < it.quantidade) {
      throw new AppError(409, 'ESTOQUE_INSUFICIENTE', 'Estoque insuficiente para um dos itens', {
        variacao_id: String(it.variacaoId), disponivel: Math.max(livre, 0),
      });
    }
    await conn.execute('UPDATE produto_variacoes SET estoque_reservado = estoque_reservado + ? WHERE id = ?', [it.quantidade, it.variacaoId]);
    reservas.push({ variacaoId: it.variacaoId, quantidade: it.quantidade, saldoApos: v.estoque_disponivel });
  }
  return reservas;
}

async function registrarReservas(conn, reservas, pedidoId) {
  for (const r of reservas) {
    await registrar(conn, { variacaoId: r.variacaoId, tipo: 'reserva', quantidade: r.quantidade, saldoApos: r.saldoApos, pedidoId, origem: 'loja' });
  }
}

async function itensDoPedido(conn, pedidoId) {
  const [rows] = await conn.execute(
    'SELECT variacao_id, quantidade FROM pedido_itens WHERE pedido_id = ? AND variacao_id IS NOT NULL ORDER BY variacao_id',
    [pedidoId],
  );
  return rows;
}

/** Cancelamento/expiracao: devolve a reserva. */
async function liberarReserva(conn, pedidoId) {
  for (const it of await itensDoPedido(conn, pedidoId)) {
    const v = await travarVariacao(conn, it.variacao_id);
    const qtd = Math.min(it.quantidade, v.estoque_reservado);
    await conn.execute('UPDATE produto_variacoes SET estoque_reservado = estoque_reservado - ? WHERE id = ?', [qtd, it.variacao_id]);
    await registrar(conn, {
      variacaoId: it.variacao_id, tipo: 'liberacao', quantidade: qtd, saldoApos: v.estoque_disponivel, pedidoId, origem: 'loja',
    });
  }
}

/** Pagamento aprovado: a reserva vira baixa. O Bling confirmara o saldo absoluto depois. */
async function baixarReserva(conn, pedidoId) {
  for (const it of await itensDoPedido(conn, pedidoId)) {
    const v = await travarVariacao(conn, it.variacao_id);
    const qtd = Math.min(it.quantidade, v.estoque_reservado);
    const novoSaldo = Math.max(v.estoque_disponivel - qtd, 0);
    await conn.execute(
      'UPDATE produto_variacoes SET estoque_reservado = estoque_reservado - ?, estoque_disponivel = ? WHERE id = ?',
      [qtd, novoSaldo, it.variacao_id],
    );
    await registrar(conn, {
      variacaoId: it.variacao_id, tipo: 'saida', quantidade: qtd, saldoApos: novoSaldo, pedidoId, origem: 'loja',
    });
  }
}

/** Cancelamento de pedido ja pago/baixado: o saldo volta para disponivel. */
async function devolverAoEstoque(conn, pedidoId, origem = 'admin') {
  for (const it of await itensDoPedido(conn, pedidoId)) {
    const v = await travarVariacao(conn, it.variacao_id);
    const novoSaldo = v.estoque_disponivel + it.quantidade;
    await conn.execute('UPDATE produto_variacoes SET estoque_disponivel = ? WHERE id = ?', [novoSaldo, it.variacao_id]);
    await registrar(conn, {
      variacaoId: it.variacao_id, tipo: 'entrada', quantidade: it.quantidade, saldoApos: novoSaldo, pedidoId, origem,
    });
  }
}

module.exports = { ajustarSaldoAdmin, aplicarSaldoBling, reservar, registrarReservas, liberarReserva, baixarReserva, devolverAoEstoque };
