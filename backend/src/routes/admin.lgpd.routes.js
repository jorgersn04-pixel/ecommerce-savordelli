'use strict';

const { Router } = require('express');
const c = require('../controllers/lgpd.controller');
const { exigirPermissao } = require('../middlewares/rbac');

// Montado sob /admin. Somente quem tem lgpd.gerenciar (por padrao, o papel admin).
const router = Router();
const gerenciar = exigirPermissao('lgpd.gerenciar');

router.get('/lgpd/solicitacoes', gerenciar, c.listarAdmin);
router.put('/lgpd/solicitacoes/:id', gerenciar, c.atualizarSolicitacao);
router.get('/lgpd/clientes/:id/exportar', gerenciar, c.exportarAdmin);
router.post('/lgpd/clientes/:id/anonimizar', gerenciar, c.anonimizarAdmin);

module.exports = router;
