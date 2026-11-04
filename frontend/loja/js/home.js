import { CONFIG } from './config.js';
import { h, montar } from './core/ui.js';
import { icone } from './core/icones.js';
import { buscarLista } from './core/catalogo.js';
import { cardProduto, esqueletoGrade } from './componentes/card-produto.js';
import { montarCasca } from './shell.js';
import { plural } from './core/format.js';

const casca = montarCasca();
const principal = document.getElementById('principal');
const params = new URLSearchParams(window.location.search);

const filtros = {
  q: params.get('q') || '',
  categoria: params.get('categoria') || '',
  marca: params.get('marca') || '',
  ordem: params.get('ordem') || 'recentes',
};
const modoListagem = Boolean(filtros.q || filtros.categoria || filtros.marca || params.get('todos'));

const avisoDemo = () =>
  h(
    'div',
    { class: 'aviso', role: 'note' },
    'Vitrine de demonstração: o catálogo ainda não tem produtos cadastrados. Estes itens são fictícios e servem apenas para validar o layout.',
  );

const avisoErro = (msg, aoTentar) =>
  h('div', { class: 'vazio' }, h('strong', {}, 'Não foi possível carregar os produtos'), h('p', {}, msg), h('p', {}, h('button', { class: 'btn btn-contorno btn-pequeno', type: 'button', onclick: aoTentar }, 'Tentar novamente')));

// ---------------------------------------------------------------- Home
function banners() {
  return h(
    'section',
    { class: 'container', 'aria-label': 'Destaques' },
    h(
      'div',
      { class: 'banner hero escuro' },
      h(
        'div',
        {},
        h('span', { class: 'hero-eyebrow' }, 'Perfumaria · Maquiagem · Cuidados'),
        h('h1', {}, 'Beleza original, com o brilho que você merece'),
        h('p', { class: 'hero-texto' }, 'Descubra fragrâncias, cores e tratamentos das marcas que você já ama, com pagamento por Pix ou parcelado e entrega para todo o Brasil.'),
        // Unica acao principal (ouro) da pagina inicial.
        h('a', { class: 'btn btn-ouro', href: '#novidades' }, 'Ver lançamentos'),
      ),
      h('div', { class: 'hero-arte', 'aria-hidden': 'true' }, h('span', {}, 'S')),
    ),
    h(
      'div',
      { class: 'banners-duplos' },
      h(
        'a',
        { class: 'banner banner-categoria escuro', href: 'index.html?categoria=perfumaria' },
        h('h3', {}, 'Perfumaria'),
        h('p', {}, 'Fragrâncias femininas, masculinas e unissex.'),
        h('span', { class: 'ir' }, 'Explorar perfumes'),
      ),
      h(
        'a',
        { class: 'banner banner-categoria escuro', href: 'index.html?categoria=maquiagem' },
        h('h3', {}, 'Maquiagem'),
        h('p', {}, 'Batons, bases e olhos para todos os tons de pele.'),
        h('span', { class: 'ir' }, 'Explorar maquiagem'),
      ),
    ),
  );
}

function beneficios() {
  const item = (ic, titulo, texto) => h('div', { class: 'beneficio' }, icone(ic), h('div', {}, h('strong', {}, titulo), h('span', {}, texto)));
  return h(
    'section',
    { class: 'container', 'aria-label': 'Vantagens' },
    h(
      'div',
      { class: 'beneficios' },
      item('pix', 'Pague com Pix', 'Aprovação na hora e compra segura.'),
      item('cartao', 'Parcele sem juros', `Em até ${CONFIG.PARCELAS_MAX}x no cartão de crédito.`),
      item('original', 'Produtos originais', 'Direto do Grupo Boticário.'),
    ),
  );
}

async function renderHome() {
  const grade = h('div', {}, esqueletoGrade(CONFIG.DESTAQUES_HOME));
  montar(
    principal,
    banners(),
    beneficios(),
    h(
      'section',
      { class: 'secao', id: 'novidades', 'aria-labelledby': 'titulo-novidades' },
      h(
        'div',
        { class: 'container' },
        h(
          'div',
          { class: 'secao-cabecalho' },
          h('div', {}, h('h2', { class: 'secao-titulo', id: 'titulo-novidades' }, 'Novidades'), h('p', { class: 'secao-sub' }, 'Os produtos que acabaram de chegar à loja.')),
          h('a', { class: 'link-sutil', href: 'index.html?todos=1' }, 'Ver todos os produtos'),
        ),
        grade,
      ),
    ),
  );

  async function carregar() {
    montar(grade, esqueletoGrade(CONFIG.DESTAQUES_HOME));
    try {
      const r = await buscarLista({ ordem: 'recentes', pagina: 1, limite: CONFIG.DESTAQUES_HOME });
      montar(
        grade,
        r.demo ? avisoDemo() : null,
        r.itens.length
          ? h('ul', { class: 'grade-produtos' }, r.itens.map(cardProduto))
          : h('div', { class: 'vazio' }, h('strong', {}, 'Em breve, novidades por aqui'), h('p', {}, 'Estamos preparando o catálogo da loja.')),
      );
    } catch (e) {
      montar(grade, avisoErro(e.message, carregar));
    }
  }
  await carregar();
  await casca.carregarCategorias(filtros.categoria);
}

// ---------------------------------------------------------------- Listagem / busca / categoria
async function renderListagem() {
  let pagina = 1;
  let nomeCategoria = '';
  const titulo = h('h1', { class: 'secao-titulo' }, 'Todos os produtos');
  const contagem = h('p', { class: 'secao-sub', 'aria-live': 'polite' }, '');
  const chips = h('ul', { class: 'chips', 'aria-label': 'Filtrar por categoria' });
  const grade = h('ul', { class: 'grade-produtos' });
  const area = h('div', {}, esqueletoGrade(8));
  const rodape = h('div', { class: 'paginacao' });

  const seletor = h(
    'select',
    { class: 'seletor', id: 'ordem', onchange: () => { filtros.ordem = seletor.value; recarregar(); } },
    [['recentes', 'Mais recentes'], ['preco_asc', 'Menor preço'], ['preco_desc', 'Maior preço'], ['nome', 'Nome (A-Z)']].map(([v, r]) =>
      h('option', { value: v, selected: v === filtros.ordem }, r)),
  );

  montar(
    principal,
    h(
      'section',
      { class: 'secao' },
      h(
        'div',
        { class: 'container' },
        titulo,
        contagem,
        h('div', { class: 'ferramentas' }, chips, h('div', {}, h('label', { for: 'ordem' }, 'Ordenar por'), seletor)),
        area,
        rodape,
      ),
    ),
  );

  function atualizarTitulo() {
    const txt = filtros.q ? `Resultados para “${filtros.q}”` : nomeCategoria || 'Todos os produtos';
    titulo.textContent = txt;
    document.title = `${txt} | Savordelli`;
  }

  async function carregar(acrescentar) {
    if (!acrescentar) montar(area, esqueletoGrade(8));
    try {
      const r = await buscarLista({ ...filtros, pagina, limite: CONFIG.PRODUTOS_POR_PAGINA });
      if (!acrescentar) {
        montar(grade);
        montar(area, r.demo ? avisoDemo() : null, grade);
      }
      grade.append(...r.itens.map(cardProduto));
      const { total, paginas } = r.paginacao;
      contagem.textContent = total ? `${total} ${plural(total, 'produto encontrado', 'produtos encontrados')}` : '';
      if (total === 0) {
        montar(area, h('div', { class: 'vazio' }, h('strong', {}, 'Nenhum produto encontrado'), h('p', {}, 'Tente outro termo ou escolha uma categoria acima.'), h('p', {}, h('a', { class: 'link-sutil', href: 'index.html?todos=1' }, 'Ver todos os produtos'))));
      }
      const exibidos = grade.children.length;
      montar(
        rodape,
        pagina < paginas ? h('button', { class: 'btn btn-contorno', type: 'button', onclick: () => { pagina += 1; carregar(true); } }, 'Ver mais produtos') : null,
        total ? h('span', {}, `Exibindo ${exibidos} de ${total}`) : null,
      );
      if (!acrescentar) atualizarTitulo();
    } catch (e) {
      montar(area, avisoErro(e.message, () => carregar(acrescentar)));
      montar(rodape);
    }
  }

  function recarregar() {
    pagina = 1;
    const url = new URL(window.location.href);
    url.searchParams.set('ordem', filtros.ordem);
    window.history.replaceState(null, '', url);
    carregar(false);
  }

  await carregar(false);
  const todas = await casca.carregarCategorias(filtros.categoria);
  const raiz = todas.filter((c) => !c.pai_id);
  const atual = todas.find((c) => c.slug === filtros.categoria);
  if (atual) {
    nomeCategoria = atual.nome;
    atualizarTitulo();
  }
  const link = (rotulo, params2, ativo) => h('li', {}, h('a', { class: 'chip', href: `index.html?${new URLSearchParams(params2)}`, 'aria-current': ativo ? 'true' : null }, rotulo));
  montar(
    chips,
    link('Todas', { todos: 1 }, !filtros.categoria),
    raiz.map((c) => link(c.nome, { categoria: c.slug }, c.slug === filtros.categoria)),
  );
}

if (modoListagem) renderListagem();
else renderHome();
