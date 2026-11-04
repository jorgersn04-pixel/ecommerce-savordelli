'use strict';

const { Router } = require('express');
const c = require('../controllers/catalogo.admin.controller');
const { exigirPermissao: perm } = require('../middlewares/rbac');

// Montado sob /admin (ja autenticado como admin).
const router = Router();

router.get('/produtos', perm('produtos.ler'), c.listarProdutos);
router.post('/produtos', perm('produtos.criar'), c.criarProduto);
router.get('/produtos/:id', perm('produtos.ler'), c.obterProduto);
router.put('/produtos/:id', perm('produtos.editar'), c.atualizarProduto);
router.delete('/produtos/:id', perm('produtos.excluir'), c.excluirProduto);

router.post('/produtos/:id/variacoes', perm('produtos.editar'), c.criarVariacao);
router.put('/variacoes/:id', perm('produtos.editar'), c.atualizarVariacao);
router.put('/variacoes/:id/estoque', perm('estoque.ajustar'), c.ajustarEstoque);

router.post('/produtos/:id/imagens', perm('produtos.editar'), c.adicionarImagem);
router.delete('/imagens/:id', perm('produtos.editar'), c.removerImagem);

router.get('/marcas', perm('produtos.ler'), c.listarMarcas);
router.post('/marcas', perm('produtos.criar'), c.criarMarca);
router.put('/marcas/:id', perm('produtos.editar'), c.atualizarMarca);

router.get('/categorias', perm('produtos.ler'), c.listarCategorias);
router.post('/categorias', perm('produtos.criar'), c.criarCategoria);
router.put('/categorias/:id', perm('produtos.editar'), c.atualizarCategoria);

module.exports = router;
