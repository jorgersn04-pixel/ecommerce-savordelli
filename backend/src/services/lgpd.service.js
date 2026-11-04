'use strict';

/**
 * Direitos do titular (LGPD, Lei 13.709/2018):
 *  - acesso e portabilidade (art. 18, II e V)  -> exportar()
 *  - revogacao de consentimento (art. 8, par. 5) -> atualizarConsentimentos()
 *  - eliminacao (art. 18, VI) -> anonimizar(), respeitando a guarda fiscal (art. 16, I)
 * Pedidos pagos mantem nome/CPF/endereco no snapshot (obrigacao fiscal) por 5 anos; depois, expurgarSnapshotsVencidos().
 */
const { pool, withTransaction } = require('../config/db');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');
const { decifrar, hmac } = require('../utils/crypto');
const { verificarSenha } = require('../utils/password');
const outbox = require('./bling-outbox.service');
const { auditar } = require('./auditoria.service');

const PRAZO_RESPOSTA_DIAS = 15;
const RETENCAO_FISCAL_ANOS = 5;
const PEDIDOS_EM_ANDAMENTO = ['aguardando_pagamento', 'pago', 'em_separacao', 'enviado'];
const FINALIDADES_OPCIONAIS = ['analytics', 'marketing', 'personalizacao'];

const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const dataLimite = () => new Date(Date.now() + PRAZO_RESPOSTA_DIAS * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------ solicitacoes
async function registrarSolicitacao(exec, clienteId, tipo, { detalhes = null, concluida = false } = {}) {
  const [r] = await exec.execute(
    `INSERT INTO solicitacoes_titular (cliente_id, tipo, status, detalhes, prazo_em, concluida_em)
     VALUES (?, ?, ?, ?, ?, ${concluida ? 'UTC_TIMESTAMP()' : 'NULL'})`,
    [clienteId, tipo, concluida ? 'concluida' : 'aberta', detalhes, dataLimite()],
  );
  return String(r.insertId);
}

async function criarSolicitacao(clienteId, { tipo, detalhes }) {
  const [abertas] = await pool.execute(
    "SELECT id FROM solicitacoes_titular WHERE cliente_id = ? AND tipo = ? AND status IN ('aberta', 'em_analise')",
    [clienteId, tipo],
  );
  if (abertas.length) throw new AppError(409, 'SOLICITACAO_ABERTA', 'Ja existe uma solicitacao deste tipo em andamento');
  const id = await registrarSolicitacao(pool, clienteId, tipo, { detalhes: detalhes ?? null });
  return buscarSolicitacao(clienteId, id);
}

async function buscarSolicitacao(clienteId, id) {
  const [[s]] = await pool.execute(
    'SELECT id, tipo, status, detalhes, prazo_em, concluida_em, criado_em FROM solicitacoes_titular WHERE id = ? AND cliente_id = ?',
    [id, clienteId],
  );
  return s;
}

async function listarSolicitacoes(clienteId) {
  const [rows] = await pool.execute(
    'SELECT id, tipo, status, detalhes, prazo_em, concluida_em, criado_em FROM solicitacoes_titular WHERE cliente_id = ? ORDER BY id DESC',
    [clienteId],
  );
  return rows;
}

// ------------------------------------------------------------ consentimentos
async function estadoConsentimentos(clienteId) {
  const [rows] = await pool.execute(
    `SELECT f.codigo, f.nome, f.descricao, f.obrigatorio, f.base_legal,
            (SELECT r.concedido FROM consentimentos_registro r WHERE r.cliente_id = ? AND r.finalidade_id = f.id ORDER BY r.id DESC LIMIT 1) AS concedido,
            (SELECT r.criado_em FROM consentimentos_registro r WHERE r.cliente_id = ? AND r.finalidade_id = f.id ORDER BY r.id DESC LIMIT 1) AS atualizado_em
       FROM consentimento_finalidades f ORDER BY f.id`,
    [clienteId, clienteId],
  );
  return rows.map((r) => ({
    codigo: r.codigo,
    nome: r.nome,
    descricao: r.descricao,
    obrigatorio: Boolean(r.obrigatorio),
    base_legal: r.base_legal,
    concedido: r.obrigatorio ? true : Boolean(r.concedido),
    atualizado_em: r.atualizado_em,
  }));
}

/** Registro append-only: cada mudanca gera uma nova linha (prova do consentimento e da revogacao). */
async function atualizarConsentimentos(clienteId, pedido, { ip, userAgent }) {
  const atual = Object.fromEntries((await estadoConsentimentos(clienteId)).map((c) => [c.codigo, c.concedido]));
  const revogados = [];
  await withTransaction(async (conn) => {
    const [docs] = await conn.query(
      "SELECT id FROM documentos_legais WHERE tipo = 'politica_privacidade' AND vigente_desde <= UTC_TIMESTAMP() ORDER BY vigente_desde DESC LIMIT 1",
    );
    const [fins] = await conn.query('SELECT id, codigo FROM consentimento_finalidades');
    for (const f of fins) {
      if (!FINALIDADES_OPCIONAIS.includes(f.codigo) || pedido[f.codigo] === undefined || pedido[f.codigo] === atual[f.codigo]) continue;
      await conn.execute(
        `INSERT INTO consentimentos_registro (cliente_id, finalidade_id, documento_id, concedido, ip_hash, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [clienteId, f.id, docs[0]?.id ?? null, pedido[f.codigo] ? 1 : 0, ip ? hmac(ip) : null, userAgent ?? null],
      );
      if (!pedido[f.codigo]) revogados.push(f.codigo);
    }
    if (revogados.length) {
      await registrarSolicitacao(conn, clienteId, 'revogacao', { detalhes: `Revogado: ${revogados.join(', ')}`, concluida: true });
    }
  });
  return estadoConsentimentos(clienteId);
}

// ---------------------------------------------------------------- exportacao
/** Todos os dados pessoais do titular em JSON legivel por maquina (portabilidade). Sem hashes, chaves ou dados de terceiros. */
async function exportar(clienteId) {
  const [[c]] = await pool.execute(
    `SELECT id, nome, email, cpf_cifrado, telefone, data_nascimento, email_verificado_em, criado_em, atualizado_em
       FROM clientes WHERE id = ? AND anonimizado_em IS NULL`,
    [clienteId],
  );
  if (!c) throw new AppError(404, 'CLIENTE_NAO_ENCONTRADO', 'Cliente nao encontrado');

  const [enderecos] = await pool.execute(
    `SELECT apelido, destinatario, cep, logradouro, numero, complemento, bairro, cidade, uf, padrao, criado_em
       FROM enderecos WHERE cliente_id = ? ORDER BY id`,
    [clienteId],
  );

  const [pedidos] = await pool.execute(
    `SELECT id, numero, status, subtotal, desconto, frete_valor, total, frete_servico, frete_prazo_dias,
            snapshot_cliente, snapshot_endereco, criado_em
       FROM pedidos WHERE cliente_id = ? ORDER BY id`,
    [clienteId],
  );
  const ids = pedidos.map((p) => p.id);
  const porPedido = async (sql) => {
    if (!ids.length) return new Map();
    const [rows] = await pool.query(sql, [ids]);
    const m = new Map();
    for (const r of rows) {
      const { pedido_id: pid, ...resto } = r;
      if (!m.has(String(pid))) m.set(String(pid), []);
      m.get(String(pid)).push(resto);
    }
    return m;
  };
  const itens = await porPedido('SELECT pedido_id, sku, nome, quantidade, preco_unitario, total FROM pedido_itens WHERE pedido_id IN (?) ORDER BY id');
  const pagamentos = await porPedido('SELECT pedido_id, metodo, status, valor, parcelas, pago_em, criado_em FROM pagamentos WHERE pedido_id IN (?) ORDER BY id');
  const envios = await porPedido('SELECT pedido_id, servico, codigo_rastreio, status, postado_em, entregue_em FROM envios WHERE pedido_id IN (?) ORDER BY id');
  const historico = await porPedido('SELECT pedido_id, status_para AS status, criado_em FROM pedido_historico_status WHERE pedido_id IN (?) ORDER BY id');

  const [consentimentos] = await pool.execute(
    `SELECT f.codigo AS finalidade, r.concedido, d.tipo AS documento, d.versao AS versao_documento, r.criado_em
       FROM consentimentos_registro r
       JOIN consentimento_finalidades f ON f.id = r.finalidade_id
       LEFT JOIN documentos_legais d ON d.id = r.documento_id
      WHERE r.cliente_id = ? ORDER BY r.id`,
    [clienteId],
  );
  const [solicitacoes] = await pool.execute(
    'SELECT tipo, status, detalhes, prazo_em, concluida_em, criado_em FROM solicitacoes_titular WHERE cliente_id = ? ORDER BY id',
    [clienteId],
  );
  const [carrinho] = await pool.execute(
    `SELECT v.sku, p.nome, ci.quantidade FROM carrinhos k
       JOIN carrinho_itens ci ON ci.carrinho_id = k.id
       JOIN produto_variacoes v ON v.id = ci.variacao_id
       JOIN produtos p ON p.id = v.produto_id
      WHERE k.cliente_id = ? AND k.status = 'aberto'`,
    [clienteId],
  );

  const semCpfCifrado = (s) => {
    const { cpf_cifrado: _omitido, ...resto } = json(s);
    return resto;
  };

  return {
    gerado_em: new Date().toISOString(),
    versao_formato: 1,
    controlador: 'Savordelli Cosmeticos',
    titular: {
      nome: c.nome,
      email: c.email,
      cpf: c.cpf_cifrado ? decifrar(c.cpf_cifrado) : null,
      telefone: c.telefone,
      data_nascimento: c.data_nascimento,
      email_verificado_em: c.email_verificado_em,
      cadastrado_em: c.criado_em,
      atualizado_em: c.atualizado_em,
    },
    enderecos,
    pedidos: pedidos.map((p) => ({
      numero: p.numero,
      status: p.status,
      criado_em: p.criado_em,
      subtotal: p.subtotal,
      desconto: p.desconto,
      frete: { servico: p.frete_servico, prazo_dias: p.frete_prazo_dias, valor: p.frete_valor },
      total: p.total,
      dados_do_cliente_no_pedido: semCpfCifrado(p.snapshot_cliente),
      endereco_de_entrega: json(p.snapshot_endereco),
      itens: itens.get(String(p.id)) || [],
      pagamentos: pagamentos.get(String(p.id)) || [],
      envios: envios.get(String(p.id)) || [],
      historico_de_status: historico.get(String(p.id)) || [],
    })),
    consentimentos_historico: consentimentos,
    solicitacoes_lgpd: solicitacoes,
    carrinho_aberto: carrinho,
  };
}

/** Exportacao pelo proprio titular: gera o arquivo e deixa o registro da solicitacao atendida. */
async function exportarPeloTitular(clienteId) {
  const dados = await exportar(clienteId);
  await registrarSolicitacao(pool, clienteId, 'portabilidade', { detalhes: 'Exportacao realizada pelo titular', concluida: true });
  return dados;
}

// -------------------------------------------------------------- anonimizacao
const TEM_PAGAMENTO_EFETIVO = "EXISTS (SELECT 1 FROM pagamentos g WHERE g.pedido_id = p.id AND g.status IN ('aprovado', 'estornado'))";

/**
 * Anonimiza irreversivelmente o cadastro. O registro permanece (integridade referencial e prova de
 * consentimento), mas sem dado pessoal. Pedidos:
 *  - sem pagamento efetivo: snapshots apagados;
 *  - com pagamento efetivo: mantem nome, CPF e endereco (guarda fiscal); remove e-mail/telefone/id do cliente.
 * `ator`: { origem: 'titular' | 'admin', req }.
 */
async function anonimizar(clienteId, ator, { solicitacaoId = null, motivo = null } = {}) {
  return withTransaction(async (conn) => {
    const [[c]] = await conn.execute('SELECT id, anonimizado_em, bling_contato_id FROM clientes WHERE id = ? FOR UPDATE', [clienteId]);
    if (!c) throw new AppError(404, 'CLIENTE_NAO_ENCONTRADO', 'Cliente nao encontrado');
    if (c.anonimizado_em) throw new AppError(409, 'JA_ANONIMIZADO', 'Este cadastro ja foi anonimizado');

    const [[{ n }]] = await conn.execute(
      `SELECT COUNT(*) AS n FROM pedidos WHERE cliente_id = ? AND status IN (${PEDIDOS_EM_ANDAMENTO.map(() => '?').join(',')})`,
      [clienteId, ...PEDIDOS_EM_ANDAMENTO],
    );
    if (Number(n) > 0) {
      throw new AppError(409, 'PEDIDOS_EM_ANDAMENTO', `Ha ${n} pedido(s) em andamento. A anonimizacao e possivel apos a entrega ou o cancelamento`, {
        pedidos_em_andamento: Number(n),
      });
    }

    await conn.execute(
      `UPDATE clientes SET nome = 'Cliente anonimizado', email = CONCAT('anonimizado+', id, '@anonimizado.invalid'),
              senha_hash = '!anonimizado', cpf_cifrado = NULL, cpf_hash = NULL, telefone = NULL, data_nascimento = NULL,
              email_verificado_em = NULL, bling_contato_id = NULL, anonimizado_em = UTC_TIMESTAMP()
        WHERE id = ?`,
      [clienteId],
    );
    await conn.execute('DELETE FROM enderecos WHERE cliente_id = ?', [clienteId]);
    await conn.execute(
      'DELETE ci FROM carrinho_itens ci JOIN carrinhos k ON k.id = ci.carrinho_id WHERE k.cliente_id = ?', [clienteId],
    );
    await conn.execute("UPDATE carrinhos SET cliente_id = NULL, status = IF(status = 'aberto', 'abandonado', status) WHERE cliente_id = ?", [clienteId]);
    await conn.execute(
      "UPDATE sessoes_refresh SET revogado_em = UTC_TIMESTAMP() WHERE tipo_usuario = 'cliente' AND usuario_id = ? AND revogado_em IS NULL",
      [clienteId],
    );

    await conn.execute(
      `UPDATE pedidos p SET snapshot_cliente = JSON_OBJECT('anonimizado', TRUE), snapshot_endereco = JSON_OBJECT('anonimizado', TRUE)
        WHERE p.cliente_id = ? AND NOT ${TEM_PAGAMENTO_EFETIVO}`,
      [clienteId],
    );
    await conn.execute(
      `UPDATE pedidos p SET snapshot_cliente = JSON_REMOVE(snapshot_cliente, '$.email', '$.telefone', '$.cliente_id')
        WHERE p.cliente_id = ? AND ${TEM_PAGAMENTO_EFETIVO}`,
      [clienteId],
    );
    await conn.execute('UPDATE pedidos SET cliente_id = NULL WHERE cliente_id = ?', [clienteId]);

    // Texto livre de pedidos anteriores pode conter dado pessoal.
    await conn.execute('UPDATE solicitacoes_titular SET detalhes = NULL WHERE cliente_id = ?', [clienteId]);
    if (solicitacaoId) {
      await conn.execute(
        "UPDATE solicitacoes_titular SET status = 'concluida', concluida_em = UTC_TIMESTAMP() WHERE id = ? AND cliente_id = ?",
        [solicitacaoId, clienteId],
      );
    } else {
      await registrarSolicitacao(conn, clienteId, 'exclusao', { concluida: true });
    }

    if (c.bling_contato_id) {
      await outbox.enfileirar(conn, 'contato', clienteId, 'atualizar', { bling_contato_id: String(c.bling_contato_id), anonimizar: true });
    }
    await auditar(conn, ator.req, 'cliente.anonimizar', 'cliente', clienteId, { origem: ator.origem, motivo, solicitacao_id: solicitacaoId });
    logger.info({ clienteId, origem: ator.origem }, 'cliente anonimizado (LGPD)');
    return { anonimizado: true };
  });
}

/** Exclusao de conta pelo proprio titular: exige a senha atual. */
async function anonimizarPeloTitular(req, clienteId, senha) {
  const [[c]] = await pool.execute('SELECT senha_hash FROM clientes WHERE id = ? AND anonimizado_em IS NULL', [clienteId]);
  if (!c) throw new AppError(404, 'CLIENTE_NAO_ENCONTRADO', 'Cliente nao encontrado');
  if (!(await verificarSenha(c.senha_hash, senha))) {
    // 403 (e nao 401): o token esta valido, so a confirmacao falhou; evita disparar renovacao de sessao no frontend.
    throw new AppError(403, 'SENHA_INCORRETA', 'Senha incorreta');
  }
  return anonimizar(clienteId, { origem: 'titular', req });
}

/**
 * Apos o prazo de guarda fiscal, apaga os snapshots dos pedidos de clientes ja anonimizados.
 * Retorna a quantidade de pedidos expurgados.
 */
async function expurgarSnapshotsVencidos() {
  const [r] = await pool.execute(
    `UPDATE pedidos SET snapshot_cliente = JSON_OBJECT('anonimizado', TRUE), snapshot_endereco = JSON_OBJECT('anonimizado', TRUE)
      WHERE cliente_id IS NULL AND criado_em < UTC_TIMESTAMP() - INTERVAL ${RETENCAO_FISCAL_ANOS} YEAR
        AND JSON_EXTRACT(snapshot_cliente, '$.anonimizado') IS NULL`,
  );
  return r.affectedRows;
}

// ---------------------------------------------------------------- admin
async function listarSolicitacoesAdmin({ status, tipo, pagina, limite }) {
  const where = ['1 = 1'];
  const params = [];
  if (status) { where.push('s.status = ?'); params.push(status); }
  if (tipo) { where.push('s.tipo = ?'); params.push(tipo); }
  const w = where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM solicitacoes_titular s WHERE ${w}`, params);
  const [itens] = await pool.query(
    `SELECT s.id, s.cliente_id, s.tipo, s.status, s.prazo_em, s.concluida_em, s.criado_em, s.detalhes,
            c.nome AS cliente_nome, c.email AS cliente_email, c.anonimizado_em,
            (s.status IN ('aberta', 'em_analise') AND s.prazo_em < UTC_DATE()) AS atrasada
       FROM solicitacoes_titular s JOIN clientes c ON c.id = s.cliente_id
      WHERE ${w} ORDER BY atrasada DESC, s.prazo_em, s.id LIMIT ? OFFSET ?`,
    [...params, limite, (pagina - 1) * limite],
  );
  return {
    itens: itens.map((i) => ({ ...i, atrasada: Boolean(Number(i.atrasada)) })),
    paginacao: { pagina, limite, total: Number(total), paginas: Math.ceil(total / limite) },
  };
}

const TRANSICOES_SOLICITACAO = { aberta: ['em_analise', 'concluida', 'negada'], em_analise: ['concluida', 'negada'] };

async function atualizarSolicitacaoAdmin(req, id, { status, nota }) {
  await withTransaction(async (conn) => {
    const [[s]] = await conn.execute('SELECT id, status FROM solicitacoes_titular WHERE id = ? FOR UPDATE', [id]);
    if (!s) throw new AppError(404, 'SOLICITACAO_NAO_ENCONTRADA', 'Solicitacao nao encontrada');
    if (!(TRANSICOES_SOLICITACAO[s.status] || []).includes(status)) {
      throw new AppError(409, 'TRANSICAO_INVALIDA', `Nao e possivel ir de "${s.status}" para "${status}"`);
    }
    const final = status !== 'em_analise';
    await conn.execute(
      `UPDATE solicitacoes_titular SET status = ?, concluida_em = ${final ? 'UTC_TIMESTAMP()' : 'NULL'} WHERE id = ?`,
      [status, id],
    );
    await auditar(conn, req, 'lgpd.solicitacao', 'solicitacao_titular', id, { de: s.status, para: status, nota: nota ?? null });
  });
}

module.exports = {
  criarSolicitacao, listarSolicitacoes,
  estadoConsentimentos, atualizarConsentimentos,
  exportar, exportarPeloTitular,
  anonimizar, anonimizarPeloTitular, expurgarSnapshotsVencidos,
  listarSolicitacoesAdmin, atualizarSolicitacaoAdmin,
  PRAZO_RESPOSTA_DIAS, RETENCAO_FISCAL_ANOS,
};
