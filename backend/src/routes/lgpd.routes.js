'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const c = require('../controllers/lgpd.controller');
const { limiteLogin } = require('../middlewares/rateLimit');

// Montado sob /cliente/lgpd (ja autenticado como cliente).
const router = Router();

const limiteExportacao = rateLimit({
  windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Limite de exportacoes atingido. Tente mais tarde' } },
});

router.get('/exportar', limiteExportacao, c.exportar);
router.get('/consentimentos', c.consentimentos);
router.put('/consentimentos', c.atualizarConsentimentos);
router.get('/solicitacoes', c.listarSolicitacoes);
router.post('/solicitacoes', c.criarSolicitacao);
// Acao irreversivel: confirma a senha; falhas contam no limite anti forca-bruta.
router.post('/anonimizar', limiteLogin, c.anonimizarProprio);

module.exports = router;
