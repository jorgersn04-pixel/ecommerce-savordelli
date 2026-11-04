'use strict';

const { pool } = require('../config/db');
const { hmac } = require('../utils/crypto');

/** Registra acao administrativa em logs_auditoria. `exec` pode ser pool ou conexao de transacao. */
async function auditar(exec, req, acao, entidade, entidadeId = null, detalhes = null) {
  await (exec || pool).execute(
    `INSERT INTO logs_auditoria (admin_id, acao, entidade, entidade_id, detalhes, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      req.usuario?.id ?? null,
      acao,
      entidade,
      entidadeId,
      detalhes ? JSON.stringify(detalhes) : null,
      req.ip ? hmac(req.ip) : null,
    ],
  );
}

module.exports = { auditar };
