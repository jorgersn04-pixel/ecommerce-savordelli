// Casca compartilhada: header (escuro), navegacao por categorias, footer (escuro) e contador da sacola.
import { h, montar, toast } from './core/ui.js';
import { icone } from './core/icones.js';
import { obterCarrinho } from './core/api.js';
import { buscarCategorias } from './core/catalogo.js';

const href = (params) => `index.html?${new URLSearchParams(params)}`;

export function montarCasca() {
  const params = new URLSearchParams(window.location.search);

  document.body.prepend(h('a', { class: 'pular-conteudo', href: '#principal' }, 'Pular para o conteúdo'));

  const contador = h('span', { class: 'contador-sacola', hidden: true }, '0');
  const campoBusca = h('input', {
    type: 'search', name: 'q', placeholder: 'Buscar perfumes, maquiagem, cuidados...', autocomplete: 'off',
    'aria-label': 'Buscar produtos', value: params.get('q') || '',
  });
  const navLista = h('ul', {});

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
          h(
            'button',
            {
              class: 'link-sacola', type: 'button', 'aria-label': 'Sacola',
              // A pagina da sacola e a proxima etapa; o contador ja reflete o carrinho real da API.
              onclick: () => toast('A sacola completa será liberada na próxima etapa da loja.'),
            },
            icone('sacola'),
            h('span', { class: 'rotulo' }, 'Sacola'),
            contador,
          ),
        ),
      ),
    ),
    h('hr', { class: 'filete' }),
    h('nav', { class: 'nav-categorias', 'aria-label': 'Categorias' }, h('div', { class: 'container' }, navLista)),
  );

  const anoAtual = new Date().getFullYear();
  const listaRodape = h('ul', {}, h('li', {}, h('a', { href: './' }, 'Página inicial')), h('li', {}, h('a', { href: href({ todos: 1 }) }, 'Todos os produtos')));
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
          h('p', {}, 'Perfumaria, maquiagem e cuidados com a pele. Produtos originais, com compra segura e entrega para todo o Brasil.'),
        ),
        h('div', {}, h('h2', {}, 'Navegue'), listaRodape),
        h(
          'div',
          {},
          h('h2', {}, 'Formas de pagamento'),
          h('ul', {}, h('li', {}, 'Pix'), h('li', {}, 'Cartão de crédito'), h('li', {}, 'Boleto bancário')),
        ),
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
      montar(
        navLista,
        raiz.map((c) => h('li', {}, h('a', { href: href({ categoria: c.slug }), 'aria-current': c.slug === slugAtivo ? 'true' : null }, c.nome))),
      );
      if (raiz.length) {
        listaRodape.append(...raiz.slice(0, 6).map((c) => h('li', {}, h('a', { href: href({ categoria: c.slug }) }, c.nome))));
      }
      return itens;
    } catch {
      return [];
    }
  }

  atualizarContador();
  return { atualizarContador, carregarCategorias };
}
