'use strict';

const { pool } = require('../config/db');
const AppError = require('../utils/AppError');
const { paraCentavos } = require('../utils/formatos');

const invalido = (motivo) => new AppError(422, 'CUPOM_INVALIDO', motivo);

/**
 * Valida o cupom para o subtotal (em centavos) e calcula o beneficio.
 * `exec` pode ser a conexao do checkout (com `travar` = SELECT ... FOR UPDATE para consumo atomico).
 * Retorna { cupom, descontoCent, freteGratis } ou lanca CUPOM_INVALIDO.
 */
async function validar(codigo, subtotalCent, { exec = pool, travar = false } = {}) {
  const [rows] = await exec.execute(
    `SELECT * FROM cupons WHERE codigo = ?${travar ? ' FOR UPDATE' : ''}`,
    [String(codigo).trim()],
  );
  const c = rows[0];
  if (!c || !c.ativo) throw invalido('Cupom invalido');

  const agora = new Date();
  if (c.valido_de && new Date(c.valido_de) > agora) throw invalido('Cupom ainda nao esta valido');
  if (c.valido_ate && new Date(c.valido_ate) < agora) throw invalido('Cupom expirado');
  if (c.limite_usos !== null && c.usos >= c.limite_usos) throw invalido('Cupom esgotado');
  if (c.pedido_minimo !== null && subtotalCent < paraCentavos(c.pedido_minimo)) {
    throw invalido(`Pedido minimo de R$ ${Number(c.pedido_minimo).toFixed(2).replace('.', ',')} para este cupom`);
  }

  let descontoCent = 0;
  if (c.tipo === 'percentual') {
    descontoCent = Math.floor((subtotalCent * Math.min(Number(c.valor), 100)) / 100);
  } else if (c.tipo === 'valor_fixo') {
    descontoCent = Math.min(paraCentavos(c.valor), subtotalCent);
  }
  return { cupom: c, descontoCent, freteGratis: c.tipo === 'frete_gratis' };
}

/** Consome um uso dentro da transacao do checkout. */
async function consumir(conn, cupomId) {
  const [r] = await conn.execute(
    'UPDATE cupons SET usos = usos + 1 WHERE id = ? AND (limite_usos IS NULL OR usos < limite_usos)',
    [cupomId],
  );
  if (r.affectedRows === 0) throw invalido('Cupom esgotado');
}

/** Devolve o uso (cancelamento/expiracao do pedido). */
async function devolver(conn, cupomId) {
  await conn.execute('UPDATE cupons SET usos = GREATEST(usos - 1, 0) WHERE id = ?', [cupomId]);
}

module.exports = { validar, consumir, devolver };
