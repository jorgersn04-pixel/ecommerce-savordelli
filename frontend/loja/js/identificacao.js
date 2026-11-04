import { h, montar } from './core/ui.js';
import { ApiError } from './core/api.js';
import { entrar, cadastrar, logado } from './core/sessao.js';
import { cpfValido, emailValido, senhaValida, formatarCpf, formatarTelefone } from './core/validacao.js';
import { passos } from './componentes/passos.js';
import { montarCasca } from './shell.js';

const casca = montarCasca();
const principal = document.getElementById('principal');
const params = new URLSearchParams(window.location.search);

/** So aceita destinos internos simples (evita redirecionamento aberto). */
function destinoSeguro(valor) {
  return /^[a-z0-9-]+\.html(\?[A-Za-z0-9_=&%.-]*)?$/i.test(valor || '') ? valor : 'index.html';
}
const destino = destinoSeguro(params.get('next'));
const vindoDoCheckout = destino.startsWith('checkout');
let modo = params.get('modo') === 'cadastro' ? 'cadastro' : 'entrar';

// ------------------------------------------------------------------ campos
let seq = 0;
function campoTexto({ nome, rotulo, tipo = 'text', autocomplete, dica, inputmode, mascara, maxlength, opcional = false }) {
  const id = `f-${nome}-${++seq}`;
  const input = h('input', { id, name: nome, type: tipo, autocomplete, inputmode, maxlength, 'aria-describedby': `${id}-msg` });
  if (mascara) input.addEventListener('input', () => { input.value = mascara(input.value); });
  const erro = h('span', { class: 'erro-campo', id: `${id}-msg`, role: 'alert' });
  const el = h('div', { class: 'campo' }, h('label', { for: id }, rotulo, opcional ? h('span', { class: 'dica' }, ' (opcional)') : null), input, dica ? h('span', { class: 'dica' }, dica) : null, erro);
  return {
    el, input,
    valor: () => input.value.trim(),
    erro(msg) {
      erro.textContent = msg || '';
      if (msg) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    },
  };
}

function caixa({ nome, rotulo, descricao, obrigatorio = false }) {
  const id = `c-${nome}-${++seq}`;
  const input = h('input', { type: 'checkbox', id, name: nome, required: obrigatorio ? true : null });
  const erro = h('span', { class: 'erro-campo', role: 'alert' });
  return {
    el: h('div', { class: 'campo' }, h('label', { class: 'checkbox', for: id }, input, h('span', {}, rotulo, descricao ? h('small', {}, descricao) : null)), erro),
    marcado: () => input.checked,
    erro: (m) => { erro.textContent = m || ''; },
  };
}

const alertaGeral = () => h('div', { class: 'aviso aviso-erro', role: 'alert', hidden: true });
function mostrarAlerta(el, msg) {
  el.textContent = msg || '';
  el.hidden = !msg;
}

/** Distribui erros de validacao do servidor (zod) nos campos correspondentes. */
function erroDoServidor(err, campos, alerta) {
  if (err instanceof ApiError && err.codigo === 'VALIDACAO' && Array.isArray(err.detalhes)) {
    let achou = false;
    for (const d of err.detalhes) {
      const campo = campos[d.path?.[0]];
      if (campo) {
        campo.erro(d.message);
        achou = true;
      }
    }
    if (achou) return;
  }
  mostrarAlerta(alerta, err.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' : err.message);
}

async function concluir() {
  casca.renderizarConta();
  window.location.assign(destino);
}

// ------------------------------------------------------------------ formularios
function formEntrar() {
  const email = campoTexto({ nome: 'email', rotulo: 'E-mail', tipo: 'email', autocomplete: 'username' });
  const senha = campoTexto({ nome: 'senha', rotulo: 'Senha', tipo: 'password', autocomplete: 'current-password' });
  const alerta = alertaGeral();
  const botao = h('button', { class: 'btn btn-ouro btn-bloco', type: 'submit' }, vindoDoCheckout ? 'Entrar e continuar' : 'Entrar');
  const form = h('form', { class: 'painel-corpo', novalidate: true, 'aria-label': 'Entrar na conta' }, alerta, email.el, senha.el, botao);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    mostrarAlerta(alerta, '');
    email.erro(emailValido(email.valor()) ? '' : 'Informe um e-mail válido.');
    senha.erro(senha.input.value ? '' : 'Informe sua senha.');
    if (!emailValido(email.valor()) || !senha.input.value) return;
    botao.disabled = true;
    botao.textContent = 'Entrando...';
    try {
      await entrar(email.valor().toLowerCase(), senha.input.value);
      await concluir();
    } catch (err) {
      erroDoServidor(err, { email, senha }, alerta);
      senha.input.value = '';
      botao.disabled = false;
      botao.textContent = vindoDoCheckout ? 'Entrar e continuar' : 'Entrar';
    }
  });
  return form;
}

function formCadastro() {
  const c = {
    nome: campoTexto({ nome: 'nome', rotulo: 'Nome completo', autocomplete: 'name' }),
    email: campoTexto({ nome: 'email', rotulo: 'E-mail', tipo: 'email', autocomplete: 'email' }),
    senha: campoTexto({ nome: 'senha', rotulo: 'Senha', tipo: 'password', autocomplete: 'new-password', dica: 'Mínimo de 8 caracteres, com letras e números.' }),
    cpf: campoTexto({ nome: 'cpf', rotulo: 'CPF', inputmode: 'numeric', autocomplete: 'off', mascara: formatarCpf, maxlength: '14', dica: 'Necessário para a nota fiscal e o pagamento. Armazenado de forma cifrada.' }),
    telefone: campoTexto({ nome: 'telefone', rotulo: 'Telefone', tipo: 'tel', inputmode: 'tel', autocomplete: 'tel', mascara: formatarTelefone, maxlength: '15', opcional: true }),
    data_nascimento: campoTexto({ nome: 'data_nascimento', rotulo: 'Data de nascimento', tipo: 'date', autocomplete: 'bday', opcional: true }),
  };
  const termos = caixa({ nome: 'aceite_termos', rotulo: 'Li e aceito os Termos de Uso e a Política de Privacidade.', obrigatorio: true });
  const analytics = caixa({ nome: 'analytics', rotulo: 'Permitir estatísticas de uso', descricao: 'Medição anônima de navegação para melhorar a loja.' });
  const marketing = caixa({ nome: 'marketing', rotulo: 'Receber ofertas e novidades', descricao: 'Comunicações por e-mail. Você pode revogar quando quiser.' });
  const personalizacao = caixa({ nome: 'personalizacao', rotulo: 'Receber recomendações personalizadas', descricao: 'Sugestões com base no seu histórico de compras.' });
  const alerta = alertaGeral();
  const botao = h('button', { class: 'btn btn-ouro btn-bloco', type: 'submit' }, vindoDoCheckout ? 'Criar conta e continuar' : 'Criar conta');

  const form = h(
    'form',
    { class: 'painel-corpo', novalidate: true, 'aria-label': 'Criar conta' },
    alerta,
    c.nome.el, c.email.el,
    h('div', { class: 'grade-campos' }, c.cpf.el, c.telefone.el),
    c.data_nascimento.el, c.senha.el,
    h('hr', { class: 'filete' }),
    h('div', { class: 'campo' }, h('strong', {}, 'Privacidade (LGPD)'), h('span', { class: 'dica' }, 'Usamos seus dados para processar pedidos, emitir nota fiscal e entregar suas compras. Os consentimentos opcionais abaixo ficam desmarcados e podem ser alterados depois.')),
    termos.el, analytics.el, marketing.el, personalizacao.el,
    botao,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    mostrarAlerta(alerta, '');
    const v = (campo, ok, msg) => { campo.erro(ok ? '' : msg); return ok; };
    const validos = [
      v(c.nome, c.nome.valor().length >= 3, 'Informe seu nome completo.'),
      v(c.email, emailValido(c.email.valor()), 'Informe um e-mail válido.'),
      v(c.cpf, cpfValido(c.cpf.valor()), 'CPF inválido.'),
      v(c.senha, senhaValida(c.senha.input.value), 'A senha deve ter 8 ou mais caracteres, com letras e números.'),
      v({ erro: termos.erro }, termos.marcado(), 'É necessário aceitar os termos para criar a conta.'),
    ];
    if (validos.includes(false)) {
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    const tel = c.telefone.valor().replace(/\D/g, '');
    const corpo = {
      nome: c.nome.valor(),
      email: c.email.valor().toLowerCase(),
      senha: c.senha.input.value,
      cpf: c.cpf.valor().replace(/\D/g, ''),
      ...(tel ? { telefone: tel } : {}),
      ...(c.data_nascimento.valor() ? { data_nascimento: c.data_nascimento.valor() } : {}),
      aceite_termos: true,
      consentimentos: { analytics: analytics.marcado(), marketing: marketing.marcado(), personalizacao: personalizacao.marcado() },
    };
    botao.disabled = true;
    botao.textContent = 'Criando conta...';
    try {
      await cadastrar(corpo);
      await concluir();
    } catch (err) {
      const duplicado = err instanceof ApiError && err.codigo === 'CADASTRO_DUPLICADO';
      if (duplicado) c[/CPF/.test(err.message) ? 'cpf' : 'email'].erro(err.message);
      else erroDoServidor(err, { ...c, aceite_termos: { erro: termos.erro } }, alerta);
      botao.disabled = false;
      botao.textContent = vindoDoCheckout ? 'Criar conta e continuar' : 'Criar conta';
    }
  });
  return form;
}

// ------------------------------------------------------------------ pagina
function render() {
  const abaEntrar = h('button', { class: 'aba', type: 'button', role: 'tab', 'aria-selected': modo === 'entrar' ? 'true' : 'false', onclick: () => { modo = 'entrar'; render(); } }, 'Já tenho conta');
  const abaCadastro = h('button', { class: 'aba', type: 'button', role: 'tab', 'aria-selected': modo === 'cadastro' ? 'true' : 'false', onclick: () => { modo = 'cadastro'; render(); } }, 'Criar conta');
  document.title = `${modo === 'entrar' ? 'Entrar' : 'Criar conta'} | Savordelli`;

  montar(
    principal,
    h(
      'div',
      { class: 'container' },
      h('div', { class: 'fluxo-topo' }, h('h1', {}, modo === 'entrar' ? 'Entrar' : 'Criar conta'), vindoDoCheckout ? passos(2) : null),
      h(
        'div',
        { class: 'auth-centro' },
        h('p', { class: 'muted-texto' }, vindoDoCheckout ? 'Identifique-se para finalizar a compra. Sua sacola será mantida.' : 'Acesse sua conta ou crie uma nova para comprar com mais rapidez.'),
        h('div', { class: 'abas duas', role: 'tablist', 'aria-label': 'Acesso' }, abaEntrar, abaCadastro),
        h('div', { class: 'painel', role: 'tabpanel' }, modo === 'entrar' ? formEntrar() : formCadastro()),
      ),
    ),
  );
}

async function iniciar() {
  await casca.pronta;
  if (logado()) {
    window.location.replace(destino);
    return;
  }
  render();
  await Promise.all([casca.carregarCategorias(), casca.carregarMarcas()]);
}

iniciar();
