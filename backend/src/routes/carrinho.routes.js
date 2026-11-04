'use strict';

const { Router } = require('express');
const c = require('../controllers/carrinho.controller');
const { autenticarOpcional } = require('../middlewares/auth');
const rateLimit = require('express-rate-limit');

const router = Router();

// Cotacao chama API externa: limite proprio por IP.
const limiteFrete = rateLimit({
  windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas cotacoes. Aguarde um instante' } },
});

// Carrinho: anonimo (cookie) ou cliente logado (Bearer opcional).
router.use('/carrinho', autenticarOpcional);
router.get('/carrinho', c.ver);
router.post('/carrinho/itens', c.adicionar);
router.put('/carrinho/itens/:variacaoId', c.definir);
router.delete('/carrinho/itens/:variacaoId', c.remover);
router.delete('/carrinho', c.esvaziar);
router.post('/carrinho/frete', limiteFrete, c.cotarFrete);

router.post('/frete/cotar', limiteFrete, c.cotarAvulso);

module.exports = router;
