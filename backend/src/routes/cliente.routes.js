'use strict';

const { Router } = require('express');
const c = require('../controllers/cliente.controller');
const { autenticar } = require('../middlewares/auth');

const router = Router();

// Area do cliente logado.
router.use(autenticar('cliente'));

router.use('/lgpd', require('./lgpd.routes'));

router.get('/me', c.perfil);
router.put('/me', c.atualizarPerfil);

router.get('/enderecos', c.listarEnderecos);
router.post('/enderecos', c.criarEndereco);
router.put('/enderecos/:id', c.atualizarEndereco);
router.delete('/enderecos/:id', c.removerEndereco);

module.exports = router;
