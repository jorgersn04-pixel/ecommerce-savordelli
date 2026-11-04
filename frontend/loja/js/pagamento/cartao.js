// Formulario de cartao do checkout transparente.
//
// SEGURANCA: o numero do cartao e o CVV NUNCA sao enviados ao nosso servidor. O servidor recebe apenas um TOKEN
// de uso unico + a bandeira.
//  - Modo "real": campos seguros do Mercado Pago (iframes); o numero nao passa pelo nosso JavaScript.
//  - Modo "simulado" (sem credenciais): campos locais so para validar a interface; o token e fabricado no navegador.
import { h } from '../core/ui.js';
import { CONFIG } from '../config.js';
import { moeda } from '../core/format.js';
import { formatarCartao, formatarValidade, luhnValido, bandeiraDoCartao, cpfValido, formatarCpf } from '../core/validacao.js';

const CARTAO_RECUSA_TESTE = '4000000000000002';

/** Opcoes de parcelas sem juros respeitando a parcela minima. */
export function opcoesParcelas(total) {
  const n = Math.max(1, Math.min(CONFIG.PARCELAS_MAX, Math.floor(Number(total) / CONFIG.PARCELA_MINIMA)));
  return Array.from({ length: n }, (_, i) => ({
    valor: i + 1,
    rotulo: i === 0 ? `1x de ${moeda(total)} (à vista)` : `${i + 1}x de ${moeda(Number(total) / (i + 1))} sem juros`,
  }));
}

let seq = 0;
function campo({ rotulo, nome, extra }) {
  const id = `cc-${nome}-${++seq}`;
  const erro = h('span', { class: 'erro-campo', id: `${id}-msg`, role: 'alert' });
  const el = h('div', { class: 'campo' }, h('label', { for: id }, rotulo), extra(id), erro);
  return { el, erro: (m) => { erro.textContent = m || ''; }, id };
}

function seletorParcelas(total) {
  const select = h('select', { name: 'parcelas', id: 'cc-parcelas' }, opcoesParcelas(total).map((o) => h('option', { value: o.valor }, o.rotulo)));
  return { el: h('div', { class: 'campo cheio' }, h('label', { for: 'cc-parcelas' }, 'Parcelas'), select), valor: () => Number(select.value) };
}

// ------------------------------------------------------------------ modo simulado
function formularioSimulado({ total }) {
  const entradas = {};
  const mk = (nome, rotulo, props, mascara) => campo({
    rotulo, nome,
    extra: (id) => {
      const i = h('input', { id, name: nome, autocomplete: props.autocomplete, inputmode: props.inputmode, maxlength: props.maxlength, placeholder: props.placeholder, 'aria-describedby': `${id}-msg` });
      if (mascara) i.addEventListener('input', () => { i.value = mascara(i.value); });
      entradas[nome] = i;
      return i;
    },
  });
  const limpaAoDigitar = (c, nome) => entradas[nome].addEventListener('input', () => c.erro(''));
  const numero = mk('numero', 'Número do cartão', { autocomplete: 'cc-number', inputmode: 'numeric', maxlength: '23', placeholder: '0000 0000 0000 0000' }, formatarCartao);
  const nome = mk('nome', 'Nome impresso no cartão', { autocomplete: 'cc-name', placeholder: 'Como aparece no cartão' });
  const validade = mk('validade', 'Validade', { autocomplete: 'cc-exp', inputmode: 'numeric', maxlength: '5', placeholder: 'MM/AA' }, formatarValidade);
  const cvv = mk('cvv', 'Código de segurança', { autocomplete: 'cc-csc', inputmode: 'numeric', maxlength: '4', placeholder: 'CVV' }, (v) => v.replace(/\D/g, '').slice(0, 4));
  const parcelas = seletorParcelas(total);
  limpaAoDigitar(numero, 'numero');
  limpaAoDigitar(nome, 'nome');
  limpaAoDigitar(validade, 'validade');
  limpaAoDigitar(cvv, 'cvv');

  const el = h(
    'div',
    { class: 'stack-form' },
    h('p', { class: 'nota-teste' }, `Ambiente de teste: nenhum cartão real é cobrado e os dados não saem do seu navegador. Use qualquer número válido (ex.: 5555 5555 5555 4444) ou ${formatarCartao(CARTAO_RECUSA_TESTE)} para simular uma recusa.`),
    h('div', { class: 'grade-campos' }, h('div', { class: 'cheio' }, numero.el), h('div', { class: 'cheio' }, nome.el), validade.el, cvv.el, parcelas.el),
  );

  return {
    el,
    validar() {
      const n = entradas.numero.value.replace(/\D/g, '');
      const [mm, aa] = entradas.validade.value.split('/');
      const agora = new Date();
      const ano = 2000 + Number(aa);
      const validadeOk = /^\d{2}\/\d{2}$/.test(entradas.validade.value) && Number(mm) >= 1 && Number(mm) <= 12 && (ano > agora.getFullYear() || (ano === agora.getFullYear() && Number(mm) >= agora.getMonth() + 1));
      const r = [
        [numero, luhnValido(n), 'Número de cartão inválido.'],
        [nome, entradas.nome.value.trim().length >= 3, 'Informe o nome como está no cartão.'],
        [validade, validadeOk, 'Validade inválida ou vencida.'],
        [cvv, /^\d{3,4}$/.test(entradas.cvv.value), 'Informe o código de segurança.'],
      ];
      for (const [c, ok, msg] of r) c.erro(ok ? '' : msg);
      return r.every(([, ok]) => ok);
    },
    /** Fabrica o token no navegador. O numero em si nao e retornado nem enviado. */
    async obterDados() {
      const n = entradas.numero.value.replace(/\D/g, '');
      const aleatorio = crypto.getRandomValues(new Uint32Array(2)).join('');
      return {
        token: n === CARTAO_RECUSA_TESTE ? 'tok_recusado' : `tok_sim_${aleatorio}`,
        payment_method_id: bandeiraDoCartao(n),
        parcelas: parcelas.valor(),
      };
    },
    limparSensiveis() {
      entradas.numero.value = '';
      entradas.cvv.value = '';
    },
  };
}

// ------------------------------------------------------------------ modo real (Mercado Pago)
function carregarSdk() {
  if (window.MercadoPago) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://sdk.mercadopago.com/js/v2';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar o pagamento por cartão. Tente novamente.'));
    document.head.appendChild(s);
  });
}

/**
 * Campos seguros do Mercado Pago (SDK v2). ATENCAO: esta implementacao segue a documentacao publica do SDK, mas
 * ainda nao foi exercitada com credenciais reais; valide em homologacao antes de publicar.
 */
async function formularioMercadoPago({ total, publicKey }) {
  await carregarSdk();
  const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
  const montar = (id) => h('div', { id, class: 'campo-mp' });
  const idNum = `mp-numero-${++seq}`;
  const idVal = `mp-validade-${seq}`;
  const idCvv = `mp-cvv-${seq}`;
  const nome = campo({ rotulo: 'Nome impresso no cartão', nome: 'nome', extra: (id) => h('input', { id, name: 'nome', autocomplete: 'cc-name' }) });
  const cpf = campo({ rotulo: 'CPF do titular do cartão', nome: 'cpf', extra: (id) => { const i = h('input', { id, name: 'cpf', inputmode: 'numeric', maxlength: '14', autocomplete: 'off' }); i.addEventListener('input', () => { i.value = formatarCpf(i.value); }); return i; } });
  const parcelas = seletorParcelas(total);
  const rotulo = (t, id) => h('label', { for: id }, t);

  const el = h(
    'div',
    { class: 'stack-form' },
    h('div', { class: 'grade-campos' },
      h('div', { class: 'campo cheio' }, rotulo('Número do cartão', idNum), montar(idNum)),
      h('div', { class: 'cheio' }, nome.el),
      h('div', { class: 'campo' }, rotulo('Validade', idVal), montar(idVal)),
      h('div', { class: 'campo' }, rotulo('Código de segurança', idCvv), montar(idCvv)),
      h('div', { class: 'cheio' }, cpf.el),
      parcelas.el),
  );

  let campos = null;
  let bin = '';
  let metodo = null;
  const montarCampos = () => {
    // Os iframes so podem ser montados depois que os contenedores estiverem no DOM.
    campos = {
      numero: mp.fields.create('cardNumber', { placeholder: '0000 0000 0000 0000' }).mount(idNum),
      validade: mp.fields.create('expirationDate', { placeholder: 'MM/AA' }).mount(idVal),
      cvv: mp.fields.create('securityCode', { placeholder: 'CVV' }).mount(idCvv),
    };
    campos.numero.on('binChange', async ({ bin: novo }) => {
      if (!novo || novo === bin) return;
      bin = novo;
      try {
        const r = await mp.getPaymentMethods({ bin: novo });
        metodo = r.results?.[0] || null;
      } catch {
        metodo = null;
      }
    });
  };
  queueMicrotask(() => setTimeout(montarCampos, 0));

  return {
    el,
    validar() {
      const okNome = nome.el.querySelector('input').value.trim().length >= 3;
      const okCpf = cpfValido(cpf.el.querySelector('input').value);
      nome.erro(okNome ? '' : 'Informe o nome como está no cartão.');
      cpf.erro(okCpf ? '' : 'CPF inválido.');
      return okNome && okCpf;
    },
    async obterDados() {
      const t = await mp.fields.createCardToken({
        cardholderName: nome.el.querySelector('input').value.trim(),
        identificationType: 'CPF',
        identificationNumber: cpf.el.querySelector('input').value.replace(/\D/g, ''),
      });
      if (!t?.id || !metodo?.id) throw new Error('Confira os dados do cartão e tente novamente.');
      return { token: t.id, payment_method_id: metodo.id, issuer_id: metodo.issuer?.id ? String(metodo.issuer.id) : undefined, parcelas: parcelas.valor() };
    },
    limparSensiveis() {
      campos?.numero?.unmount?.();
      campos?.validade?.unmount?.();
      campos?.cvv?.unmount?.();
    },
  };
}

/** Cria o formulario conforme o modo informado pela API (/pagamentos/config). */
export async function criarFormularioCartao({ config, total }) {
  if (config.modo === 'real' && config.public_key) return formularioMercadoPago({ total, publicKey: config.public_key });
  return formularioSimulado({ total });
}
