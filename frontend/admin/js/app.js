// Casca do painel: menu lateral, barra superior e roteador por hash (#/rota?query).
import { restaurar, sair, temPermissao } from './core/auth.js';
import { h, montar, carregando, alerta, botao } from './core/ui.js';
import { icone } from './core/icons.js';

/** Itens do menu. `permissao` controla a visibilidade (o servidor reaplica a regra em toda chamada). */
const MENU = [
  { rota: '/', rotulo: 'Visao geral', icone: 'dashboard' },
  { rota: '/pedidos', rotulo: 'Pedidos', icone: 'pedidos', permissao: 'pedidos.ler' },
  { rota: '/produtos', rotulo: 'Produtos', icone: 'produtos', permissao: 'produtos.ler' },
  { rota: '/cupons', rotulo: 'Cupons', icone: 'cupons', permissao: 'cupons.ler' },
  { rota: '/bling', rotulo: 'Integracao Bling', icone: 'bling', permissao: 'bling.gerenciar', grupo: 'Sistema' },
];

/** Cada rota carrega seu modulo sob demanda. `menu` indica qual item do menu fica ativo. */
const ROTAS = [
  { re: /^\/$/, menu: '/', titulo: 'Visao geral', carregar: () => import('./modules/dashboard.js'), fn: 'render' },
  { re: /^\/pedidos$/, menu: '/pedidos', titulo: 'Pedidos', carregar: () => import('./modules/pedidos.js'), fn: 'lista' },
  { re: /^\/pedidos\/(\d+)$/, menu: '/pedidos', titulo: 'Pedido', carregar: () => import('./modules/pedidos.js'), fn: 'detalhe' },
  { re: /^\/produtos$/, menu: '/produtos', titulo: 'Produtos', carregar: () => import('./modules/produtos.js'), fn: 'lista' },
  { re: /^\/produtos\/novo$/, menu: '/produtos', titulo: 'Novo produto', carregar: () => import('./modules/produtos.js'), fn: 'novo' },
  { re: /^\/produtos\/(\d+)$/, menu: '/produtos', titulo: 'Produto', carregar: () => import('./modules/produtos.js'), fn: 'detalhe' },
  { re: /^\/cupons$/, menu: '/cupons', titulo: 'Cupons', carregar: () => import('./modules/cupons.js'), fn: 'render' },
  { re: /^\/bling$/, menu: '/bling', titulo: 'Integracao Bling', carregar: () => import('./modules/bling.js'), fn: 'render' },
];

const raiz = document.getElementById('app');
let areaConteudo;
let tituloEl;
let navEl;
let geracao = 0; // descarta renderizacoes antigas quando o usuario navega rapido

function lerHash() {
  const bruto = window.location.hash.replace(/^#/, '') || '/';
  const [caminho, qs = ''] = bruto.split('?');
  return { caminho: caminho || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function navegar(caminho) {
  window.location.hash = `#${caminho}`;
}

function construirCasca(usuario) {
  const itens = MENU.filter((m) => temPermissao(m.permissao));
  let grupoAtual = null;
  const links = itens.flatMap((m) => {
    const out = [];
    if (m.grupo && m.grupo !== grupoAtual) out.push(h('div', { class: 'nav-label' }, m.grupo));
    grupoAtual = m.grupo || grupoAtual;
    out.push(h('a', { class: 'nav-link', href: `#${m.rota}`, dataset: { rota: m.rota } }, icone(m.icone), m.rotulo));
    return out;
  });
  navEl = h('nav', { class: 'nav', 'aria-label': 'Navegacao principal' }, links);

  tituloEl = h('h1', {}, '');
  areaConteudo = h('div', { class: 'content', id: 'conteudo', tabindex: '-1' });

  const fecharMenu = () => raiz.classList.remove('nav-open');

  montar(
    raiz,
    h(
      'aside',
      { class: 'sidebar' },
      h(
        'div',
        { class: 'brand' },
        h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'S'),
        h('div', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'Savordelli'), h('span', { class: 'brand-sub' }, 'Painel administrativo')),
      ),
      navEl,
      h(
        'div',
        { class: 'sidebar-foot' },
        h('div', { class: 'user-chip' }, h('strong', {}, usuario.nome), h('span', {}, usuario.papel)),
        botao('Sair', { tipo: 'ghost', icon: 'sair', onClick: async () => { await sair(); window.location.replace('index.html'); } }),
      ),
    ),
    h('div', { class: 'backdrop', onclick: fecharMenu }),
    h(
      'div',
      { class: 'main' },
      h('header', { class: 'topbar' }, botao('', { tipo: 'ghost', icon: 'menu', titulo: 'Abrir menu', onClick: () => raiz.classList.toggle('nav-open') }), tituloEl),
      h('main', {}, areaConteudo),
    ),
  );
  navEl.addEventListener('click', (e) => {
    if (e.target.closest('a')) fecharMenu();
  });
}

function marcarMenu(rotaMenu) {
  for (const a of navEl.querySelectorAll('.nav-link')) {
    if (a.dataset.rota === rotaMenu) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

async function rotear() {
  const minha = ++geracao;
  const { caminho, query } = lerHash();
  const rota = ROTAS.map((r) => ({ r, m: r.re.exec(caminho) })).find((x) => x.m);

  if (!rota) {
    tituloEl.textContent = 'Nao encontrado';
    marcarMenu(null);
    montar(areaConteudo, alerta('Pagina nao encontrada.', 'warn'));
    return;
  }

  const { r, m } = rota;
  tituloEl.textContent = r.titulo;
  document.title = `${r.titulo} - Painel Savordelli`;
  marcarMenu(r.menu);
  montar(areaConteudo, carregando());

  try {
    const modulo = await r.carregar();
    if (minha !== geracao) return;
    const bloco = h('div', { class: 'stack' });
    await modulo[r.fn](bloco, { params: m.slice(1), query, titulo: (t) => { tituloEl.textContent = t; }, navegar });
    if (minha !== geracao) return;
    montar(areaConteudo, bloco);
    areaConteudo.focus({ preventScroll: true });
  } catch (err) {
    if (minha !== geracao) return;
    montar(
      areaConteudo,
      alerta(err.status === 403 ? 'Voce nao tem permissao para acessar esta area.' : `Nao foi possivel carregar: ${err.message}`, 'danger'),
      botao('Tentar novamente', { onClick: rotear }),
    );
  }
}

async function iniciar() {
  const usuario = await restaurar();
  if (!usuario) {
    window.location.replace('index.html');
    return;
  }
  construirCasca(usuario);
  window.addEventListener('sessao-expirada', () => window.location.replace('index.html'));
  window.addEventListener('hashchange', rotear);
  if (!window.location.hash) window.location.hash = '#/';
  await rotear();
}

iniciar();
