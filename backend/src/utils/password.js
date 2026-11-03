'use strict';

const argon2 = require('argon2');

// Senhas: parametros padrao do argon2 (argon2id, 64 MiB, t=3).
async function hashSenha(senha) {
  return argon2.hash(senha, { type: argon2.argon2id });
}

async function verificarSenha(hash, senha) {
  try {
    return await argon2.verify(hash, senha);
  } catch {
    return false;
  }
}

// Refresh tokens: segredo com 256 bits de entropia, entao parametros mais leves
// (minimo OWASP) bastam e mantem o /refresh rapido.
const OPCOES_TOKEN = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

async function hashToken(segredo) {
  return argon2.hash(segredo, OPCOES_TOKEN);
}

// Hash descartavel para igualar o tempo de resposta quando o e-mail nao existe.
let hashFalso;
async function verificarSenhaFalsa(senha) {
  hashFalso ??= hashSenha('senha-falsa-para-igualar-tempo');
  return verificarSenha(await hashFalso, senha);
}

module.exports = { hashSenha, verificarSenha, hashToken, verificarSenhaFalsa };
