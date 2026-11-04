'use strict';

const s = require('../services/lgpd.service');
const v = require('../validators/lgpd.validators');
const { idParams } = require('../validators/comum');
const { auditar } = require('../services/auditoria.service');

const contexto = (req) => ({ ip: req.ip, userAgent: (req.get('user-agent') || '').slice(0, 255) || null });

module.exports = {
  // ------------------------------------------------------------ titular
  async exportar(req, res) {
    const dados = await s.exportarPeloTitular(req.usuario.id);
    res.set('Content-Disposition', 'attachment; filename="meus-dados-savordelli.json"');
    res.set('Cache-Control', 'no-store');
    res.json(dados);
  },
  async consentimentos(req, res) {
    res.json({ itens: await s.estadoConsentimentos(req.usuario.id) });
  },
  async atualizarConsentimentos(req, res) {
    res.json({ itens: await s.atualizarConsentimentos(req.usuario.id, v.consentimentos.parse(req.body), contexto(req)) });
  },
  async listarSolicitacoes(req, res) {
    res.json({ itens: await s.listarSolicitacoes(req.usuario.id) });
  },
  async criarSolicitacao(req, res) {
    res.status(201).json(await s.criarSolicitacao(req.usuario.id, v.criarSolicitacao.parse(req.body)));
  },
  async anonimizarProprio(req, res) {
    const { senha } = v.anonimizarProprio.parse(req.body);
    res.json(await s.anonimizarPeloTitular(req, req.usuario.id, senha));
  },

  // -------------------------------------------------------------- admin
  async listarAdmin(req, res) {
    res.json(await s.listarSolicitacoesAdmin(v.listaAdmin.parse(req.query)));
  },
  async atualizarSolicitacao(req, res) {
    await s.atualizarSolicitacaoAdmin(req, idParams.parse(req.params).id, v.atualizarSolicitacao.parse(req.body));
    res.status(204).end();
  },
  async exportarAdmin(req, res) {
    const { id } = idParams.parse(req.params);
    const dados = await s.exportar(id);
    await auditar(null, req, 'cliente.exportar', 'cliente', id); // acesso administrativo a dados pessoais
    res.set('Content-Disposition', `attachment; filename="dados-cliente-${id}.json"`);
    res.set('Cache-Control', 'no-store');
    res.json(dados);
  },
  async anonimizarAdmin(req, res) {
    const { id } = idParams.parse(req.params);
    const { solicitacao_id: solicitacaoId, motivo } = v.anonimizarAdmin.parse(req.body);
    res.json(await s.anonimizar(id, { origem: 'admin', req }, { solicitacaoId, motivo }));
  },
};
