'use strict';

const { Router } = require('express');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { pool } = require('../config/db');
const gateway = require('../integrations/mercadopago/client');
const pagamentos = require('../services/pagamento.service');
const { autenticar } = require('../middlewares/auth');
const { numeroParams } = require('../validators/pedido.validators');

const router = Router();

/** Configuracao PUBLICA do checkout (a chave publica do Mercado Pago e feita para ficar no navegador). */
router.get('/config', (_req, res) => {
  res.json({
    modo: gateway.simulado ? 'simulado' : 'real',
    public_key: gateway.simulado ? null : env.MERCADOPAGO_PUBLIC_KEY ?? null,
    parcelas_max: 12,
  });
});

/**
 * Apenas desenvolvimento/homologacao: com o gateway SIMULADO (sem credenciais) e fora de producao, aprova o
 * pagamento pendente do pedido para permitir percorrer o fluxo PIX/boleto sem o Mercado Pago real.
 */
router.post('/simular/:numero/aprovar', autenticar('cliente'), async (req, res) => {
  if (!gateway.simulado || env.isProd) throw new AppError(404, 'ROTA_NAO_ENCONTRADA', 'Rota não encontrada');
  const { numero } = numeroParams.parse(req.params);
  const [[pg]] = await pool.execute(
    `SELECT g.provedor_transacao_id AS t FROM pagamentos g JOIN pedidos p ON p.id = g.pedido_id
      WHERE p.numero = ? AND p.cliente_id = ? AND g.status = 'pendente' AND g.provedor_transacao_id IS NOT NULL
      ORDER BY g.id DESC LIMIT 1`,
    [numero, req.usuario.id],
  ).then(([rows]) => [rows]);
  if (!pg) throw new AppError(404, 'PAGAMENTO_NAO_ENCONTRADO', 'Nenhum pagamento pendente para este pedido');
  gateway.definirStatusSimulado(pg.t, 'approved');
  await pagamentos.reconciliarPorTransacao(pg.t);
  res.json({ ok: true });
});

module.exports = router;
