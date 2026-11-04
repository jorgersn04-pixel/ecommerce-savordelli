// Mascaras e validacoes de formulario (a validacao definitiva e sempre a do servidor).

export function formatarCpf(valor) {
  const d = String(valor).replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function formatarTelefone(valor) {
  const d = String(valor).replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Digitos verificadores do CPF (mesma regra do servidor). */
export function cpfValido(cpf) {
  const d = String(cpf).replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i += 1) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim());

export const senhaValida = (s) => s.length >= 8 && /[A-Za-z]/.test(s) && /\d/.test(s);

/** Algoritmo de Luhn para numero de cartao. */
export function luhnValido(numero) {
  const d = String(numero).replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let soma = 0;
  let dobrar = false;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let n = Number(d[i]);
    if (dobrar) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

export function formatarCartao(valor) {
  return String(valor).replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
}

export function formatarValidade(valor) {
  const d = String(valor).replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

/** Bandeira por BIN (aproximacao para o modo de teste; no modo real a bandeira vem do Mercado Pago). */
export function bandeiraDoCartao(numero) {
  const d = String(numero).replace(/\D/g, '');
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'master';
  if (/^3[47]/.test(d)) return 'amex';
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(d)) return 'elo';
  if (/^(606282|3841)/.test(d)) return 'hipercard';
  return 'master';
}
