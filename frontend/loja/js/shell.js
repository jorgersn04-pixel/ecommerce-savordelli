// Casca compartilhada: header (escuro), navegacao por marcas e categorias, footer (escuro) e contador da sacola.
import { h, montar } from './core/ui.js';
import { icone } from './core/icones.js';
import { obterCarrinho } from './core/api.js';
import { buscarCategorias, buscarMarcas } from './core/catalogo.js';

const href = (params) => `index.html?${new URLSearchParams(params)}`;

export function montarCasca() {
  const params = new URLSearchParams(window.location.search);

  document.body.prepend(h('a', { class: 'pular-conteudo', href: '#principal' }, 'Pular para o conteúdo'));

  const contador = h('span', { class: 'contador-sacola', hidden: true }, '0');
  const campoBusca = h('input', {
    type: 'search', name: 'q', placeholder: 'Buscar perfumes, maquiagem, cuidados...', autocomplete: 'off',
    'aria-label': 'Buscar produtos', value: params.get('q') || '',
  });
  const navCategorias = h('ul', { class: 'nav-itens' });
  const listaMarcasMenu = h('ul', {});
  const menuMarcas = h(
    'details',
    { class: 'menu-marcas' },
    h('summary', {}, 'Marcas'),
    h('div', { class: 'menu-marcas-painel' }, listaMarcasMenu),
  );

  const cabecalho = document.getElementById('cabecalho');
  cabecalho.className = 'site-header escuro';
  montar(
    cabecalho,
    h(
      'div',
      { class: 'container' },
      h(
        'div',
        { class: 'header-linha' },
        h('a', { class: 'logo', href: './', 'aria-label': 'Savordelli Cosméticos - página inicial' }, 'Savordelli', h('small', {}, 'Cosméticos')),
        h(
          'form',
          { class: 'busca', role: 'search', action: 'index.html', method: 'get' },
          campoBusca,
          h('button', { type: 'submit', 'aria-label': 'Buscar' }, icone('busca')),
        ),
        h(
          'div',
          { class: 'header-acoes' },
          h('a', { class: 'link-sacola', href: 'sacola.html', 'aria-label': 'Sacola' }, icone('sacola'), h('span', { class: 'rotulo' }, 'Sacola'), contador),
        ),
      ),
    ),
    h('hr', { class: 'filete' }),
    h('nav', { class: 'nav-categorias', 'aria-label': 'Marcas e categorias' }, h('div', { class: 'container nav-linha' }, menuMarcas, navCategorias)),
  );

  // Fecha o menu de marcas ao clicar fora ou com Esc.
  document.addEventListener('click', (e) => {
    if (menuMarcas.open && !menuMarcas.contains(e.target)) menuMarcas.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuMarcas.open) {
      menuMarcas.open = false;
      menuMarcas.querySelector('summary').focus();
    }
  });

  const anoAtual = new Date().getFullYear();
  const colNavegue = h('ul', {}, h('li', {}, h('a', { href: './' }, 'Página inicial')), h('li', {}, h('a', { href: href({ todos: 1 }) }, 'Todos os produtos')));
  const colMarcas = h('ul', {});
  const rodape = document.getElementById('rodape');
  rodape.className = 'site-footer escuro';
  montar(
    rodape,
    h('hr', { class: 'filete' }),
    h(
      'div',
      { class: 'container' },
      h(
        'div',
        { class: 'footer-grade' },
        h(
          'div',
          { class: 'footer-marca' },
          h('a', { class: 'logo', href: './' }, 'Savordelli', h('small', {}, 'Cosméticos')),
          h('p', {}, 'Perfumaria, maquiagem e cuidados com a pele das melhores marcas. Produtos originais, compra segura e entrega para todo o Brasil.'),
        ),
        h('div', {}, h('h2', {}, 'Navegue'), colNavegue),
        h('div', {}, h('h2', {}, 'Marcas'), colMarcas),
        h('div', {}, h('h2', {}, 'Pagamento'), h('ul', {}, h('li', {}, 'Pix'), h('li', {}, 'Cartão de crédito'), h('li', {}, 'Boleto bancário'))),
      ),
      h('div', { class: 'footer-base' }, h('span', {}, `© ${anoAtual} Savordelli Cosméticos. Todos os direitos reservados.`)),
    ),
  );

  async function atualizarContador() {
    try {
      const c = await obterCarrinho();
      const n = Number(c.quantidade_itens) || 0;
      contador.textContent = n > 99 ? '99+' : String(n);
      contador.hidden = n === 0;
      contador.parentElement.setAttribute('aria-label', n ? `Sacola, ${n} item(ns)` : 'Sacola');
    } catch {
      contador.hidden = true; // API indisponivel: o contador simplesmente nao aparece
    }
  }

  /** Chamar DEPOIS do conteudo principal carregar (a vitrine de demonstracao e decidida la). */
  async function carregarCategorias(slugAtivo) {
    try {
      const { itens } = await buscarCategorias();
      const raiz = itens.filter((c) => !c.pai_id);
      montar(navCategorias, raiz.map((c) => h('li', {}, h('a', { href: href({ categoria: c.slug }), 'aria-current': c.slug === slugAtivo ? 'true' : null }, c.nome))));
      colNavegue.append(...raiz.slice(0, 5).map((c) => h('li', {}, h('a', { href: href({ categoria: c.slug }) }, c.nome))));
      return itens;
    } catch {
      return [];
    }
  }

  async function carregarMarcas(slugAtivo) {
    const marcas = await buscarMarcas();
    montar(
      listaMarcasMenu,
      h('li', {}, h('a', { href: 'index.html?todos=1#marcas' }, 'Todas as marcas')),
      marcas.map((m) => h('li', {}, h('a', { href: href({ marca: m.slug }), 'aria-current': m.slug === slugAtivo ? 'true' : null }, m.nome))),
    );
    montar(colMarcas, marcas.map((m) => h('li', {}, h('a', { href: href({ marca: m.slug }) }, m.nome))));
    if (slugAtivo) menuMarcas.querySelector('summary').classList.add('ativo');
    return marcas;
  }

  atualizarContador();
  return { atualizarContador, carregarCategorias, carregarMarcas };
}
