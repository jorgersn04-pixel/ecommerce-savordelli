'use strict';

/**
 * Cria um admin ou cliente para desenvolvimento/bootstrap.
 *   node scripts/criar-usuario.js admin   email@x.com "Nome" admin|operador|financeiro SENHA
 *   node scripts/criar-usuario.js cliente email@x.com "Nome" SENHA
 */
const { pool } = require('../src/config/db');
const { hashSenha } = require('../src/utils/password');

async function main() {
  const [tipo, email, nome, ...resto] = process.argv.slice(2);
  if (tipo === 'admin' && resto.length === 2) {
    const [papel, senha] = resto;
    const [[p]] = await pool.execute('SELECT id FROM papeis WHERE nome = ?', [papel]);
    if (!p) throw new Error(`Papel inexistente: ${papel}`);
    await pool.execute(
      'INSERT INTO admin_usuarios (papel_id, nome, email, senha_hash) VALUES (?, ?, ?, ?)',
      [p.id, nome, email.toLowerCase(), await hashSenha(senha)],
    );
  } else if (tipo === 'cliente' && resto.length === 1) {
    await pool.execute('INSERT INTO clientes (nome, email, senha_hash) VALUES (?, ?, ?)', [
      nome,
      email.toLowerCase(),
      await hashSenha(resto[0]),
    ]);
  } else {
    console.error('Uso:\n  admin   <email> <nome> <papel> <senha>\n  cliente <email> <nome> <senha>');
    process.exitCode = 1;
    return;
  }
  console.log(`${tipo} criado: ${email}`);
}

main()
  .catch((err) => {
    console.error(err.code === 'ER_DUP_ENTRY' ? 'E-mail ja cadastrado' : err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
