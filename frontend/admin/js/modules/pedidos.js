import { get, put, querystring } from '../core/api.js';
import { h, cartao, tabela, paginacao, badgeDe, botao, campo, modal, confirmar, executar, cabecalhoPagina, montar, carregando, alerta } from '../core/ui.js';
import { moeda, dataHora, STATUS_PEDIDO, STATUS_PAGAMENTO, METODO } from '../core/format.js';
import { temPermissao } from '../core/auth.js';

// Espelho da maquina de estados do servidor (que e quem valida de fato).
const TRANSICOES = {
  aguardando_pagamento: ['cancelado'],
  pago: ['em_separacao', 'cancelado'],
  em_separacao: ['enviado', 'cancelado'],
  enviado: ['entregue'],
  entregue: ['reembolsado'],
  cancelado: ['reembolsado'],
  reembolsado: [],
};

const ROTULO_ACAO = {
  em_separacao: 'Iniciar separacao',
  enviado: 'Marcar como enviado',
  entregue: 'Marcar como entregue',
  cancelado: 'Cancelar pedido',
  reembolsado: 'Registrar reembolso',
};

// ---------------------------------------------------------------------- lista
export async function lista(container, { navegar }) {
  const estado = { status: '', q: '', pagina: 1 };
  const area = h('div', { class: 'card' });

  async function carregar() {
    montar(area, carregando());
    const r = await get(`/admin/pedidos${querystring({ status: estado.status, q: estado.q, pagina: estado.pagina, limite: 20 })}`);
    montar(
      area,
      tabela({
        colunas: [
          { titulo: 'Pedido', render: (p) => h('span', { class: 'mono cell-main' }, p.numero) },
          { titulo: 'Cliente', render: (p) => p.cliente_nome || '-' },
          { titulo: 'Situacao', render: (p) => badgeDe(STATUS_PEDIDO, p.status) },
          { titulo: 'Frete', render: (p) => p.frete_servico || '-' },
          { titulo: 'Total', classe: 'right nowrap', render: (p) => h('strong', {}, moeda(p.total)) },
          { titulo: 'Data', classe: 'nowrap', render: (p) => dataHora(p.criado_em) },
        ],
        linhas: r.itens,
        aoClicar: (p) => navegar(`/pedidos/${p.id}`),
        vazioTitulo: 'Nenhum pedido encontrado',
        vazioTexto: 'Ajuste os filtros ou aguarde novas vendas.',
      }),
      paginacao({ ...r.paginacao, aoMudar: (p) => { estado.pagina = p; carregar(); } }),
    );
  }

  const fStatus = campo({
    rotulo: 'Situacao',
    nome: 'status',
    tipo: 'select',
    opcoes: [{ valor: '', rotulo: 'Todas' }, ...Object.entries(STATUS_PEDIDO).map(([v, [r]]) => ({ valor: v, rotulo: r }))],
  });
  const fBusca = campo({ rotulo: 'Buscar', nome: 'q', placeholder: 'Numero, nome ou e-mail do cliente' });
  fStatus.input.addEventListener('change', () => { estado.status = fStatus.input.value; estado.pagina = 1; carregar(); });
  fBusca.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { estado.q = fBusca.input.value.trim(); estado.pagina = 1; carregar(); }
  });

  container.append(
    cabecalhoPagina('Pedidos', 'Acompanhe e atualize o andamento das vendas.'),
    h('div', { class: 'filters' }, fStatus.el, fBusca.el),
    area,
  );
  await carregar();
}

// -------------------------------------------------------------------- detalhe
function kv(pares) {
  return h('dl', { class: 'kv' }, pares.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '-')]));
}

export async function detalhe(container, { params, titulo, navegar }) {
  const id = params[0];
  const raiz = h('div', { class: 'stack' });
  container.append(raiz);

  async function carregar() {
    const p = await get(`/admin/pedidos/${id}`);
    titulo(`Pedido ${p.numero}`);
    const e = p.endereco_entrega;
    const podeAtualizar = temPermissao('pedidos.atualizar');
    const proximos = TRANSICOES[p.status] || [];

    montar(
      raiz,
      cabecalhoPagina(
        p.numero,
        `Criado em ${dataHora(p.criado_em)}`,
        botao('Voltar', { icon: 'voltar', onClick: () => navegar('/pedidos') }),
      ),
      h(
        'div',
        { class: 'grid split' },
        h(
          'div',
          { class: 'stack' },
          cartao(
            'Itens',
            tabela({
              colunas: [
                { titulo: 'Produto', render: (i) => h('div', {}, h('div', { class: 'cell-main' }, i.nome), h('div', { class: 'cell-sub mono' }, i.sku)) },
                { titulo: 'Qtd', classe: 'right', render: (i) => i.quantidade },
                { titulo: 'Unitario', classe: 'right nowrap', render: (i) => moeda(i.preco_unitario) },
                { titulo: 'Total', classe: 'right nowrap', render: (i) => h('strong', {}, moeda(i.total)) },
              ],
              linhas: p.itens,
            }),
            { plano: true },
          ),
          cartao(
            'Pagamentos',
            tabela({
              colunas: [
                { titulo: 'Metodo', render: (g) => METODO[g.metodo] || g.metodo },
                { titulo: 'Situacao', render: (g) => badgeDe(STATUS_PAGAMENTO, g.status) },
                { titulo: 'Parcelas', classe: 'right', render: (g) => `${g.parcelas}x` },
                { titulo: 'Valor', classe: 'right nowrap', render: (g) => moeda(g.valor) },
                { titulo: 'Transacao', render: (g) => h('span', { class: 'mono faint' }, g.provedor_transacao_id || '-') },
              ],
              linhas: p.pagamentos,
              vazioTitulo: 'Sem tentativas de pagamento',
            }),
            { plano: true },
          ),
          cartao(
            'Historico',
            h(
              'ol',
              { class: 'timeline' },
              p.historico.map((x) =>
                h(
                  'li',
                  {},
                  h('div', { class: 'row' }, badgeDe(STATUS_PEDIDO, x.status), h('span', { class: 'faint' }, x.autor || '')),
                  x.observacao ? h('div', { class: 'muted' }, x.observacao) : null,
                  h('div', { class: 'when' }, dataHora(x.criado_em)),
                ),
              ),
            ),
          ),
        ),
        h(
          'div',
          { class: 'stack' },
          cartao(
            'Resumo',
            h(
              'div',
              { class: 'stack' },
              h('div', {}, badgeDe(STATUS_PEDIDO, p.status)),
              kv([
                ['Subtotal', moeda(p.subtotal)],
                ['Desconto', Number(p.desconto) > 0 ? `- ${moeda(p.desconto)}` : moeda(0)],
                [`Frete (${p.frete.servico || '-'})`, `${moeda(p.frete.valor)}${p.frete.prazo_dias ? ` - ${p.frete.prazo_dias} dia(s)` : ''}`],
                ['Total', h('strong', {}, moeda(p.total))],
                ['Bling', p.bling_pedido_id ? `#${p.bling_pedido_id}` : 'Ainda nao enviado'],
              ]),
            ),
          ),
          proximos.length && podeAtualizar
            ? cartao(
                'Acoes',
                h(
                  'div',
                  { class: 'stack' },
                  proximos.map((s) =>
                    botao(ROTULO_ACAO[s], { tipo: s === 'cancelado' ? 'danger' : 'primary', onClick: () => abrirTransicao(p, s) }),
                  ),
                ),
              )
            : null,
          p.status === 'cancelado' && p.historico.at(-1)?.observacao?.includes('reembolso pendente')
            ? alerta('Reembolso pendente: devolva o valor ao cliente e depois registre o reembolso.', 'warn')
            : null,
          cartao('Cliente', kv([['Nome', p.cliente.nome], ['E-mail', p.cliente.email], ['Telefone', p.cliente.telefone]])),
          cartao(
            'Entrega',
            h(
              'div',
              { class: 'stack' },
              h('div', {}, h('div', { class: 'cell-main' }, e.destinatario), h('div', { class: 'muted' }, `${e.logradouro}, ${e.numero}${e.complemento ? ` - ${e.complemento}` : ''}`), h('div', { class: 'muted' }, `${e.bairro} - ${e.cidade}/${e.uf}`), h('div', { class: 'muted mono' }, `CEP ${e.cep.slice(0, 5)}-${e.cep.slice(5)}`)),
              p.envios.length ? kv(p.envios.flatMap((v) => [[v.servico, v.codigo_rastreio || 'sem rastreio']])) : null,
            ),
          ),
        ),
      ),
    );
  }

  async function abrirTransicao(pedido, novoStatus) {
    const obs = campo({ rotulo: 'Observacao (opcional)', nome: 'observacao', tipo: 'textarea', linhas: 3 });
    const rastreio = novoStatus === 'enviado' ? campo({ rotulo: 'Codigo de rastreio', nome: 'rastreio', placeholder: 'Ex.: BR123456789BR' }) : null;
    const aviso = novoStatus === 'cancelado' && pedido.status !== 'aguardando_pagamento'
      ? alerta('O pedido ja foi pago: o estoque volta ao saldo e o reembolso fica pendente.', 'warn')
      : null;

    modal({
      titulo: ROTULO_ACAO[novoStatus],
      corpo: h('div', { class: 'stack' }, aviso, rastreio?.el, obs.el),
      acoes: [
        { rotulo: 'Voltar', aoClicar: (fechar) => fechar() },
        {
          rotulo: 'Confirmar',
          tipo: novoStatus === 'cancelado' ? 'danger' : 'primary',
          aoClicar: async (fechar, btn) => {
            if (novoStatus === 'cancelado' && !(await confirmar('Cancelar este pedido? A acao nao pode ser desfeita.', { rotulo: 'Cancelar pedido', perigo: true }))) return;
            const ok = await executar(btn, () =>
              put(`/admin/pedidos/${id}/status`, {
                status: novoStatus,
                ...(obs.valor() ? { observacao: obs.valor() } : {}),
                ...(rastreio?.valor() ? { codigo_rastreio: rastreio.valor() } : {}),
              }), { sucesso: 'Pedido atualizado' });
            if (ok) {
              fechar();
              await carregar();
            }
          },
        },
      ],
    });
  }

  await carregar();
}
