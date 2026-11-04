import { get } from '../core/api.js';
import { h, cartao, estatistica, tabela, badgeDe, alerta, vazio, cabecalhoPagina } from '../core/ui.js';
import { moeda, numero, dataCurta, STATUS_PEDIDO } from '../core/format.js';
import { temPermissao } from '../core/auth.js';

function graficoBarras(serie) {
  if (!serie.length) return vazio('Sem vendas no periodo', 'Os pedidos pagos dos ultimos 14 dias aparecem aqui.');
  const max = Math.max(...serie.map((s) => Number(s.receita)), 1);
  return h(
    'div',
    { class: 'bars', role: 'img', 'aria-label': 'Receita diaria dos ultimos 14 dias' },
    serie.map((s) => {
      const barra = h('div', { class: 'bar', title: `${dataCurta(s.dia)}: ${moeda(s.receita)} (${s.pedidos} pedido(s))` });
      barra.style.height = `${Math.max((Number(s.receita) / max) * 100, 2)}%`;
      return h('div', { class: 'bar-col' }, barra, h('span', { class: 'bar-label' }, dataCurta(s.dia)));
    }),
  );
}

export async function render(container) {
  const d = await get('/admin/dashboard');
  const fila = d.fila_bling || {};
  const falhas = (fila.morto || 0) + (fila.erro || 0);
  const aguardando = d.pedidos_por_status.aguardando_pagamento || 0;

  const statusLinhas = Object.entries(STATUS_PEDIDO).map(([chave]) => ({ chave, n: d.pedidos_por_status[chave] || 0 }));

  container.append(
    cabecalhoPagina('Visao geral', 'Resumo da operacao da loja.'),
    falhas > 0 && temPermissao('bling.gerenciar')
      ? alerta(h('span', {}, `Ha ${falhas} item(ns) da fila do Bling com falha. `, h('a', { href: '#/bling' }, 'Ver integracao')), 'warn')
      : null,
    h(
      'div',
      { class: 'grid cols-4' },
      estatistica('Pedidos hoje', numero(d.hoje.pedidos), `Receita: ${moeda(d.hoje.receita)}`),
      estatistica('Receita (30 dias)', moeda(d.ultimos_30_dias.receita), `${numero(d.ultimos_30_dias.pedidos)} pedido(s) pago(s)`),
      estatistica('Aguardando pagamento', numero(aguardando), 'Estoque reservado ate o prazo'),
      estatistica('Produtos ativos', numero(d.produtos_ativos), 'Publicados na loja'),
    ),
    h(
      'div',
      { class: 'grid split' },
      cartao('Receita dos ultimos 14 dias', graficoBarras(d.serie_14_dias)),
      cartao(
        'Pedidos por status',
        h(
          'ul',
          { class: 'stack plain' },
          statusLinhas.map((s) => h('li', { class: 'row between' }, badgeDe(STATUS_PEDIDO, s.chave), h('strong', {}, numero(s.n)))),
        ),
      ),
    ),
    cartao(
      `Estoque baixo (${d.limite_estoque_baixo} unidades ou menos)`,
      tabela({
        colunas: [
          { titulo: 'Produto', render: (l) => h('div', {}, h('div', { class: 'cell-main' }, l.nome), h('div', { class: 'cell-sub mono' }, l.sku)) },
          { titulo: 'Disponivel', classe: 'right', render: (l) => h('strong', {}, numero(l.disponivel)) },
        ],
        linhas: d.estoque_baixo,
        vazioTitulo: 'Nenhum item com estoque baixo',
        vazioTexto: 'O estoque e espelhado do Bling.',
      }),
      { plano: true },
    ),
  );
}
