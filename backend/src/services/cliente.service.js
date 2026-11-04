'use strict';

const { pool, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { hashSenha } = require('../utils/password');
const { cifrar, decifrar, hmac } = require('../utils/crypto');

const MAX_ENDERECOS = 10;
const FINALIDADES_OPCIONAIS = ['analytics', 'marketing', 'personalizacao'];

/** Cria o cliente com CPF cifrado (AES-GCM) + hash HMAC para unicidade, e registra os consentimentos. */
async function registrar(dados, { ip, userAgent }) {
  const senhaHash = await hashSenha(dados.senha);
  try {
    return await withTransaction(async (conn) => {
      const [r] = await conn.execute(
        `INSERT INTO clientes (nome, email, senha_hash, cpf_cifrado, cpf_hash, telefone, data_nascimento)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dados.nome, dados.email, senhaHash, cifrar(dados.cpf), hmac(dados.cpf), dados.telefone ?? null, dados.data_nascimento ?? null],
      );
      const clienteId = String(r.insertId);

      const [docs] = await conn.query(
        `SELECT id FROM documentos_legais WHERE tipo = 'politica_privacidade' AND vigente_desde <= UTC_TIMESTAMP()
          ORDER BY vigente_desde DESC LIMIT 1`,
      );
      const doc = docs[0];
      const [finalidades] = await conn.query('SELECT id, codigo FROM consentimento_finalidades');
      const concedido = { essencial: true, ...dados.consentimentos };
      for (const f of finalidades) {
        if (f.codigo !== 'essencial' && !FINALIDADES_OPCIONAIS.includes(f.codigo)) continue;
        await conn.execute(
          `INSERT INTO consentimentos_registro (cliente_id, finalidade_id, documento_id, concedido, ip_hash, user_agent)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [clienteId, f.id, doc?.id ?? null, concedido[f.codigo] ? 1 : 0, ip ? hmac(ip) : null, userAgent],
        );
      }
      return { id: clienteId, nome: dados.nome, email: dados.email };
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const campo = /cpf_hash/.test(err.message) ? 'CPF' : 'e-mail';
      throw new AppError(409, 'CADASTRO_DUPLICADO', `Ja existe um cadastro com este ${campo}`);
    }
    throw err;
  }
}

function mascararCpf(cpf) {
  return `***.***.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

async function obterPerfil(clienteId) {
  const [[c]] = await pool.execute(
    'SELECT id, nome, email, cpf_cifrado, telefone, data_nascimento, email_verificado_em, criado_em FROM clientes WHERE id = ? AND anonimizado_em IS NULL',
    [clienteId],
  );
  if (!c) throw new AppError(404, 'CLIENTE_NAO_ENCONTRADO', 'Cliente nao encontrado');
  const { cpf_cifrado: cifrado, ...resto } = c;
  return { ...resto, cpf: cifrado ? mascararCpf(decifrar(cifrado)) : null };
}

async function atualizarPerfil(clienteId, d) {
  await pool.execute(
    `UPDATE clientes SET nome = COALESCE(?, nome),
            telefone = IF(?, ?, telefone), data_nascimento = IF(?, ?, data_nascimento)
      WHERE id = ?`,
    [d.nome ?? null, Number(d.telefone !== undefined), d.telefone ?? null, Number(d.data_nascimento !== undefined), d.data_nascimento ?? null, clienteId],
  );
  return obterPerfil(clienteId);
}

// ---------------------------------------------------------------- enderecos
async function listarEnderecos(clienteId) {
  const [rows] = await pool.execute(
    'SELECT * FROM enderecos WHERE cliente_id = ? ORDER BY padrao DESC, id', [clienteId],
  );
  return rows;
}

async function buscarEndereco(exec, clienteId, id) {
  const [rows] = await exec.execute('SELECT * FROM enderecos WHERE id = ? AND cliente_id = ?', [id, clienteId]);
  if (!rows[0]) throw new AppError(404, 'ENDERECO_NAO_ENCONTRADO', 'Endereco nao encontrado');
  return rows[0];
}

const CAMPOS = ['apelido', 'destinatario', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];
const valores = (e) => CAMPOS.map((c) => e[c] ?? null);

async function criarEndereco(clienteId, e) {
  return withTransaction(async (conn) => {
    const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM enderecos WHERE cliente_id = ? FOR UPDATE', [clienteId]);
    if (Number(n) >= MAX_ENDERECOS) throw new AppError(422, 'LIMITE_ENDERECOS', `Limite de ${MAX_ENDERECOS} enderecos`);
    const padrao = e.padrao || Number(n) === 0;
    if (padrao) await conn.execute('UPDATE enderecos SET padrao = 0 WHERE cliente_id = ?', [clienteId]);
    const [r] = await conn.execute(
      `INSERT INTO enderecos (cliente_id, ${CAMPOS.join(', ')}, padrao) VALUES (?, ${CAMPOS.map(() => '?').join(', ')}, ?)`,
      [clienteId, ...valores(e), padrao ? 1 : 0],
    );
    return buscarEndereco(conn, clienteId, r.insertId);
  });
}

async function atualizarEndereco(clienteId, id, e) {
  return withTransaction(async (conn) => {
    await buscarEndereco(conn, clienteId, id);
    if (e.padrao) await conn.execute('UPDATE enderecos SET padrao = 0 WHERE cliente_id = ?', [clienteId]);
    await conn.execute(
      `UPDATE enderecos SET ${CAMPOS.map((c) => `${c} = ?`).join(', ')}, padrao = IF(?, 1, padrao) WHERE id = ?`,
      [...valores(e), e.padrao ? 1 : 0, id],
    );
    return buscarEndereco(conn, clienteId, id);
  });
}

async function removerEndereco(clienteId, id) {
  await withTransaction(async (conn) => {
    const end = await buscarEndereco(conn, clienteId, id);
    await conn.execute('DELETE FROM enderecos WHERE id = ?', [id]);
    if (end.padrao) {
      await conn.execute('UPDATE enderecos SET padrao = 1 WHERE cliente_id = ? ORDER BY id LIMIT 1', [clienteId]);
    }
  });
}

module.exports = {
  registrar, obterPerfil, atualizarPerfil,
  listarEnderecos, buscarEndereco, criarEndereco, atualizarEndereco, removerEndereco,
};
