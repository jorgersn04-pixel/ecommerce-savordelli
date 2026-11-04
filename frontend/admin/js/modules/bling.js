import { get, post, querystring } from '../core/api.js';
import { h, cartao, tabela, paginacao, badgeDe, botao, campo, alerta, toast, executar, cabecalhoPagina, montar, carregando } from '../core/ui.js';
import { dataHora, STATUS_FILA, numero } from '../core/format.js';

const ROTULO_ENTIDADE = { produto: 'Produto', estoque: 'Estoque', pedido: 'Pedido', contato: 'Contato', nota_fiscal: 'Nota fiscal' };
const ROTULO_OPERACAO = { criar: 'Criar', atualizar: 'Atualizar', excluir: 'Excluir', emitir_nfe: 'Emitir NF-e' };

const ERROS_CALLBACK = {
  simulado: 'O Bling esta em modo simulado: defina BLING_CLIENT_ID e BLING_CLIENT_SECRET no servidor.',
  state: 'A autorizacao expirou ou e invalida. Inicie a conexao novamente.',
  autorizacao: 'O Bling recusou a autorizacao. Tente conectar novamente.',
};

export async function render(container, { query }) {
  const estado = { status: '', pagina: 1 };
  const areaStatus = h('div', {});
  const areaFila = h('div', {});

  async function carregarStatus() {
    const s = await get('/admin/bling/status');
    const simulado = s.modo === 'simulado';
    montar(
      areaStatus,
      h(
        'div',
        { class: 'stack' },
        simulado
          ? alerta('Modo simulado: nenhuma chamada real e feita ao Bling. Configure as credenciais no servidor para integrar de verdade.', 'warn')
          : s.conectado
            ? alerta(`Conta conectada. Token valido ate ${dataHora(s.token_expira_em)} (renovacao automatica).`, 'ok')
            : alerta('Conta ainda nao conectada. Autorize o aplicativo para iniciar a sincronizacao.', 'warn'),
        !simulado && !s.deposito_configurado
          ? alerta('BLING_DEPOSITO_ID nao configurado: ajustes de estoque nao poderao ser enviados ao Bling.', 'danger')
          : null,
        h(
          'div',
          { class: 'grid cols-4' },
          ...['pendente', 'erro', 'morto', 'sucesso'].map((k) =>
            h('div', { class: 'card stat' }, h('div', { class: 'stat-label' }, STATUS_FILA[k][0]), h('div', { class: 'stat-value' }, numero(s.fila[k] || 0)))),
        ),
        s.eventos_pendentes ? alerta(`${s.eventos_pendentes} evento(s) de webhook aguardando processamento.`, 'info') : null,
      ),
    );
  }

  async function carregarFila() {
    montar(areaFila, carregando());
    const r = await get(`/admin/bling/fila${querystring({ status: estado.status, pagina: estado.pagina, limite: 15 })}`);
    montar(
      areaFila,
      tabela({
        colunas: [
          { titulo: '#', render: (l) => h('span', { class: 'mono' }, l.id) },
          { titulo: 'Item', render: (l) => h('div', {}, h('div', { class: 'cell-main' }, `${ROTULO_ENTIDADE[l.entidade] || l.entidade} #${l.entidade_id}`), h('div', { class: 'cell-sub' }, ROTULO_OPERACAO[l.operacao] || l.operacao)) },
          { titulo: 'Situacao', render: (l) => badgeDe(STATUS_FILA, l.status) },
          { titulo: 'Tentativas', classe: 'right', render: (l) => l.tentativas },
          { titulo: 'Ultimo erro', render: (l) => (l.ultimo_erro ? h('span', { class: 'cell-sub' }, l.ultimo_erro.slice(0, 90)) : '-') },
          { titulo: 'Criado em', classe: 'nowrap', render: (l) => dataHora(l.criado_em) },
          {
            titulo: '',
            classe: 'right',
            render: (l) =>
              ['erro', 'morto'].includes(l.status)
                ? botao('Reprocessar', {
                    small: true,
                    onClick: (e) =>
                      executar(e.currentTarget, async () => {
                        await post(`/admin/bling/fila/${l.id}/reprocessar`);
                        await Promise.all([carregarStatus(), carregarFila()]);
                      }, { sucesso: 'Item reenfileirado' }),
                  })
                : '',
          },
        ],
        linhas: r.itens,
        vazioTitulo: 'Fila vazia',
        vazioTexto: 'Alteracoes de produtos, estoque e pedidos aparecem aqui ate serem enviadas ao Bling.',
      }),
      paginacao({ ...r.paginacao, aoMudar: (p) => { estado.pagina = p; carregarFila(); } }),
    );
  }

  const filtro = campo({
    rotulo: 'Situacao',
    nome: 'status',
    tipo: 'select',
    opcoes: [{ valor: '', rotulo: 'Todas' }, ...Object.entries(STATUS_FILA).map(([v, [r]]) => ({ valor: v, rotulo: r }))],
  });
  filtro.input.addEventListener('change', () => {
    estado.status = filtro.input.value;
    estado.pagina = 1;
    carregarFila();
  });

  if (query.conectado) toast('Conta do Bling conectada com sucesso.');
  if (query.erro) toast(ERROS_CALLBACK[query.erro] || 'Falha ao conectar ao Bling.', 'danger');

  container.append(
    cabecalhoPagina(
      'Integracao Bling',
      'O Bling e a fonte absoluta do estoque. A loja envia produtos, saldos e pedidos pela fila abaixo.',
      botao('Conectar ao Bling', {
        tipo: 'primary',
        onClick: (e) => executar(e.currentTarget, async () => {
          const { url } = await get('/admin/bling/autorizar');
          window.location.assign(url);
        }),
      }),
      botao('Sincronizar estoque agora', {
        icon: 'bling',
        onClick: (e) => executar(e.currentTarget, async () => {
          const r = await post('/admin/bling/sincronizar-estoque');
          toast(`${r.verificadas} SKU(s) verificado(s), ${r.atualizadas} atualizado(s).`);
          await carregarStatus();
        }),
      }),
    ),
    areaStatus,
    cartao('Fila de sincronizacao', h('div', { class: 'stack' }, h('div', { class: 'filters' }, filtro.el), h('div', { class: 'card' }, areaFila))),
  );

  await Promise.all([carregarStatus(), carregarFila()]);
}
