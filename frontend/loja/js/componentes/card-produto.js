import { h } from '../core/ui.js';
import { moeda, percentualDesconto, textoParcelamento } from '../core/format.js';

/** Imagem do produto ou placeholder com a inicial (sem arquivos externos). */
export function imagemProduto(url, nome, { eager = false } = {}) {
  if (url) {
    return h('img', { src: url, alt: nome, loading: eager ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  }
  return h('div', { class: 'sem-imagem', role: 'img', 'aria-label': `${nome} (sem imagem)` }, nome.trim().charAt(0).toUpperCase());
}

/** <li> com o card de um item da listagem (formato de GET /catalogo/produtos). */
export function cardProduto(p) {
  const desconto = percentualDesconto(p.preco_cheio_min, p.preco_min);
  const parcelas = textoParcelamento(p.preco_min);
  return h(
    'li',
    {},
    h(
      'a',
      { class: `card-produto ${p.disponivel ? '' : 'indisponivel'}`.trim(), href: `produto.html?slug=${encodeURIComponent(p.slug)}` },
      desconto ? h('span', { class: 'selo-desconto' }, `-${desconto}%`) : null,
      h('div', { class: 'card-imagem' }, imagemProduto(p.imagem, p.nome)),
      h(
        'div',
        { class: 'card-corpo' },
        p.marca_nome ? h('span', { class: 'card-marca' }, p.marca_nome) : null,
        h('span', { class: 'card-nome' }, p.nome),
        h(
          'div',
          { class: 'card-precos' },
          p.disponivel
            ? [
                h('div', { class: 'linha-preco-card' }, desconto ? h('span', { class: 'preco-de' }, moeda(p.preco_cheio_min)) : null, h('span', { class: 'preco-por' }, moeda(p.preco_min))),
                h('span', { class: 'parcelas' }, parcelas || ' '),
              ]
            : h('span', { class: 'aviso-indisponivel' }, 'Indisponível no momento'),
        ),
      ),
    ),
  );
}

export function esqueletoGrade(qtd = 8) {
  return h('ul', { class: 'grade-produtos', 'aria-hidden': 'true' }, Array.from({ length: qtd }, () => h('li', {}, h('div', { class: 'skeleton skeleton-card' }))));
}
