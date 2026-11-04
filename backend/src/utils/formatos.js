'use strict';

/** "Perfume Floral 100ml!" -> "perfume-floral-100ml" */
function slugify(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** Dinheiro em centavos inteiros para evitar erro de ponto flutuante. Aceita "19.90" ou 19.9. */
function paraCentavos(valor) {
  const [inteiro, dec = ''] = String(valor).split('.');
  return Number(inteiro) * 100 + Number(`${dec}00`.slice(0, 2));
}

function deCentavos(centavos) {
  return (Math.round(centavos) / 100).toFixed(2);
}

/** Preco efetivo: promocional apenas se existir e for menor que o preco cheio. */
function precoEfetivo(preco, promocional) {
  if (promocional !== null && promocional !== undefined && paraCentavos(promocional) < paraCentavos(preco)) {
    return String(promocional);
  }
  return String(preco);
}

function apenasDigitos(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function cpfValido(cpf) {
  const d = apenasDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i += 1) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

module.exports = { slugify, paraCentavos, deCentavos, precoEfetivo, apenasDigitos, cpfValido };
