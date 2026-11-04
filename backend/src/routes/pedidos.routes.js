'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const c = require('../controllers/pedido.controller');
const { autenticar } = require('../middlewares/auth');

const router = Router();

// Cada tentativa de pagamento chama o gateway: limite por IP.
const limitePagamento = rateLimit({
  windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas de pagamento. Aguarde alguns minutos' } },
});

router.use(autenticar('cliente'));

router.post('/', limitePagamento, c.criar);
router.get('/', c.listar);
router.get('/:numero', c.detalhar);
router.post('/:numero/pagar', limitePagamento, c.pagar);
router.get('/:numero/pagamento', c.pagamento);
router.post('/:numero/cancelar', c.cancelar);

module.exports = router;
