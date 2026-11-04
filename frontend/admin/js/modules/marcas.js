import { get, post, put, del } from '../core/api.js';
import { h, cartao, tabela, badge, botao, campo, modal, confirmar, executar, cabecalhoPagina, montar, carregando, alerta } from '../core/ui.js';
import { numero } from '../core/format.js';
import { temPermissao } from '../core/auth.js';

export async function render(container) {
  const area = h('div', {});
  const podeCriar = temPermissao('produtos.criar');
  const podeEditar = temPermissao('produtos.editar');
  const podeExcluir = temPermissao('produtos.excluir');

  async function carregar() {
    montar(area, carregando());
    const { itens } = await get('/admin/marcas');
    montar(
      area,
      tabela({
        colunas: [
          { titulo: 'Marca', render: (m) => h('div', {}, h('div', { class: 'cell-main' }, m.nome), h('div', { class: 'cell-sub mono' }, m.slug)) },
          { titulo: 'Produtos', classe: 'right', render: (m) => numero(m.produtos) },
          { titulo: 'Situacao', render: (m) => (m.ativo ? badge('Ativa', 'ok') : badge('Inativa', 'danger')) },
          {
            titulo: '',
            classe: 'right nowrap',
            render: (m) =>
              h(
                'div',
                { class: 'row' },
                podeEditar ? botao('Editar', { small: true, icon: 'editar', onClick: () => abrir(m) }) : null,
                podeExcluir ? botao('', { small: true, tipo: 'ghost', icon: 'lixeira', titulo: `Excluir ${m.nome}`, onClick: (e) => excluir(m, e.currentTarget) }) : null,
              ),
          },
        ],
        linhas: itens,
        vazioTitulo: 'Nenhuma marca cadastrada',
        vazioTexto: 'Cadastre as marcas que a loja revende (ex.: O Boticario, Eudora).',
      }),
    );
  }

  async function excluir(m, btn) {
    if (!(await confirmar(`Excluir a marca "${m.nome}"? Esta acao nao pode ser desfeita.`, { rotulo: 'Excluir', perigo: true }))) return;
    await executar(btn, async () => {
      await del(`/admin/marcas/${m.id}`);
      await carregar();
    }, { sucesso: 'Marca excluida' });
  }

  function abrir(m = null) {
    const nome = campo({ rotulo: 'Nome', nome: 'nome', valor: m?.nome || '', requerido: true });
    const ativo = campo({ rotulo: 'Marca ativa', nome: 'ativo', tipo: 'checkbox', valor: m ? Boolean(m.ativo) : true, dica: 'Marcas inativas deixam de aparecer nos filtros da loja' });
    modal({
      titulo: m ? `Editar marca` : 'Nova marca',
      corpo: h('div', { class: 'stack' }, nome.el, ativo.el),
      acoes: [
        { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
        {
          rotulo: 'Salvar',
          tipo: 'primary',
          aoClicar: async (fechar, btn) => {
            const corpo = { nome: nome.valor(), ativo: ativo.valor() };
            const ok = await executar(btn, () => (m ? put(`/admin/marcas/${m.id}`, corpo) : post('/admin/marcas', corpo)), { sucesso: m ? 'Marca atualizada' : 'Marca criada' });
            if (ok !== undefined) {
              fechar();
              await carregar();
            }
          },
        },
      ],
    });
  }

  container.append(
    cabecalhoPagina('Marcas', 'Marcas revendidas pela loja. O endereco (slug) e gerado a partir do nome e nao muda ao renomear.', podeCriar ? botao('Nova marca', { tipo: 'primary', icon: 'mais', onClick: () => abrir() }) : null),
    alerta('Para tirar uma marca da loja sem perder o historico, desative-a em vez de excluir. A exclusao so e permitida para marcas sem produtos.', 'info'),
    cartao(null, area, { plano: true }),
  );
  await carregar();
}
