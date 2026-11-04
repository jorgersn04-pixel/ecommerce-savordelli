'use strict';

const { Router } = require('express');
const { z } = require('zod');
const AppError = require('../utils/AppError');
const { pool } = require('../config/db');
const bling = require('../integrations/bling');
const sync = require('../services/bling-sync.service');
const webhook = require('../services/bling-webhook.service');
const { auditar } = require('../services/auditoria.service');
const { exigirPermissao: perm } = require('../middlewares/rbac');
const { idParams, paginacao } = require('../validators/comum');

const router = Router();
const gerenciar = perm('bling.gerenciar');

router.get('/bling/status', gerenciar, async (_req, res) => {
  const [fila] = await pool.query('SELECT status, COUNT(*) AS n FROM bling_sync_fila GROUP BY status');
  const [[eventos]] = await pool.query('SELECT COUNT(*) AS n FROM bling_webhook_eventos WHERE processado_em IS NULL');
  const conexao = bling.configurado ? await bling.auth.statusConexao() : { conectado: false };
  res.json({
    modo: bling.configurado ? 'real' : 'simulado',
    ...conexao,
    deposito_configurado: Boolean(require('../config/env').BLING_DEPOSITO_ID),
    fila: Object.fromEntries(fila.map((f) => [f.status, Number(f.n)])),
    eventos_pendentes: Number(eventos.n),
  });
});

router.get('/bling/autorizar', gerenciar, (_req, res) => {
  if (!bling.configurado) {
    throw new AppError(409, 'BLING_SIMULADO', 'Defina BLING_CLIENT_ID e BLING_CLIENT_SECRET para conectar ao Bling real');
  }
  res.json({ url: bling.auth.urlAutorizacao() });
});

const filtroFila = paginacao.extend({ status: z.enum(['pendente', 'processando', 'sucesso', 'erro', 'morto']).optional() });

router.get('/bling/fila', gerenciar, async (req, res) => {
  const { status, pagina, limite } = filtroFila.parse(req.query);
  const where = status ? 'WHERE status = ?' : '';
  const params = status ? [status] : [];
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM bling_sync_fila ${where}`, params);
  const [itens] = await pool.query(
    `SELECT id, entidade, entidade_id, operacao, status, tentativas, ultimo_erro, proxima_tentativa_em, criado_em
       FROM bling_sync_fila ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limite, (pagina - 1) * limite],
  );
  res.json({ itens, paginacao: { pagina, limite, total: Number(total), paginas: Math.ceil(total / limite) } });
});

router.post('/bling/fila/:id/reprocessar', gerenciar, async (req, res) => {
  const { id } = idParams.parse(req.params);
  await sync.reprocessar(id);
  await auditar(null, req, 'bling.reprocessar', 'bling_sync_fila', id);
  res.status(204).end();
});

router.post('/bling/sincronizar-estoque', gerenciar, async (req, res) => {
  const r = await webhook.sincronizarEstoqueCompleto();
  await auditar(null, req, 'bling.sincronizar_estoque', 'bling', null, r);
  res.json(r);
});

module.exports = router;
