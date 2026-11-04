'use strict';

/**
 * Outbox: toda alteracao que precisa chegar ao Bling e gravada em bling_sync_fila na MESMA
 * transacao da mudanca de negocio. Um worker (fase de integracao Bling) consome a fila.
 */
async function enfileirar(conn, entidade, entidadeId, operacao, payload = null) {
  await conn.execute(
    'INSERT INTO bling_sync_fila (entidade, entidade_id, operacao, payload) VALUES (?, ?, ?, ?)',
    [entidade, entidadeId, operacao, payload ? JSON.stringify(payload) : null],
  );
}

module.exports = { enfileirar };
