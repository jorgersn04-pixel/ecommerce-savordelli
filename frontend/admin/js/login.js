import { entrar, restaurar } from './core/auth.js';

const form = document.getElementById('form-login');
const erro = document.getElementById('login-erro');
const botao = document.getElementById('btn-login');

const irParaPainel = () => window.location.replace('app.html');

// Sessao ainda valida (cookie de refresh): pula o login.
restaurar().then((u) => {
  if (u) irParaPainel();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erro.hidden = true;
  const email = form.email.value.trim();
  const senha = form.senha.value;
  if (!email || !senha) {
    erro.textContent = 'Informe e-mail e senha.';
    erro.hidden = false;
    return;
  }
  botao.disabled = true;
  botao.textContent = 'Entrando...';
  try {
    await entrar(email, senha);
    irParaPainel();
  } catch (err) {
    erro.textContent = err.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' : err.message;
    erro.hidden = false;
    botao.disabled = false;
    botao.textContent = 'Entrar';
    form.senha.value = '';
    form.senha.focus();
  }
});
