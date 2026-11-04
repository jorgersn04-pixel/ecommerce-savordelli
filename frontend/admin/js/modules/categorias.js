import { get, post, put, del } from '../core/api.js';
import { h, cartao, tabela, badge, botao, campo, modal, confirmar, executar, cabecalhoPagina, montar, carregando, alerta } from '../core/ui.js';
import { numero } from '../core/format.js';
import { temPermissao } from '../core/auth.js';

/** Ordena em arvore (pai antes dos filhos) e anota a profundidade de cada categoria. */
function emArvore(itens) {
  const porPai = new Map();
  const ids = new Set(itens.map((c) => String(c.id)));
  for (const c of itens) {
    // Pai ausente (removido) vira raiz.
    const chave = c.pai_id && ids.has(String(c.pai_id)) ? String(c.pai_id) : 'raiz';
    if (!porPai.has(chave)) porPai.set(chave, []);
    porPai.get(chave).push(c);
  }
  const saida = [];
  const visitar = (chave, nivel) => {
    for (const c of porPai.get(chave) || []) {
      saida.push({ ...c, nivel });
      if (nivel < 10) visitar(String(c.id), nivel + 1);
    }
  };
  visitar('raiz', 0);
  return saida;
}

/** Ids da categoria e de todos os descendentes (nao podem ser escolhidos como pai). */
function descendentes(itens, id) {
  const alvo = new Set([String(id)]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const c of itens) {
      if (c.pai_id && alvo.has(String(c.pai_id)) && !alvo.has(String(c.id))) {
        alvo.add(String(c.id));
        mudou = true;
      }
    }
  }
  return alvo;
}

export async function render(container) {
  const area = h('div', {});
  const podeCriar = temPermissao('produtos.criar');
  const podeEditar = temPermissao('produtos.editar');
  const podeExcluir = temPermissao('produtos.excluir');
  let todas = [];

  async function carregar() {
    montar(area, carregando());
    todas = (await get('/admin/categorias')).itens;
    const linhas = emArvore(todas);
    montar(
      area,
      tabela({
        colunas: [
          {
            titulo: 'Categoria',
            render: (c) => {
              const nome = h('div', { class: 'cell-main' }, c.nivel > 0 ? `- ${c.nome}` : c.nome);
              nome.style.paddingLeft = `${c.nivel * 20}px`;
              return h('div', {}, nome, h('div', { class: 'cell-sub mono' }, c.slug));
            },
          },
          { titulo: 'Ordem', classe: 'right', render: (c) => c.ordem },
          { titulo: 'Produtos', classe: 'right', render: (c) => numero(c.produtos) },
          { titulo: 'Bling', render: (c) => (c.bling_categoria_id ? h('span', { class: 'mono' }, `#${c.bling_categoria_id}`) : h('span', { class: 'faint' }, '-')) },
          { titulo: 'Situacao', render: (c) => (c.ativo ? badge('Ativa', 'ok') : badge('Inativa', 'danger')) },
          {
            titulo: '',
            classe: 'right nowrap',
            render: (c) =>
              h(
                'div',
                { class: 'row' },
                podeEditar ? botao('Editar', { small: true, icon: 'editar', onClick: () => abrir(c) }) : null,
                podeExcluir ? botao('', { small: true, tipo: 'ghost', icon: 'lixeira', titulo: `Excluir ${c.nome}`, onClick: (e) => excluir(c, e.currentTarget) }) : null,
              ),
          },
        ],
        linhas,
        vazioTitulo: 'Nenhuma categoria cadastrada',
        vazioTexto: 'Crie categorias (e subcategorias) para organizar a vitrine.',
      }),
    );
  }

  async function excluir(c, btn) {
    const filhas = todas.filter((x) => String(x.pai_id) === String(c.id)).length;
    const aviso = filhas ? ` Suas ${filhas} subcategoria(s) passarao a ser categorias principais.` : '';
    if (!(await confirmar(`Excluir a categoria "${c.nome}"?${aviso}`, { rotulo: 'Excluir', perigo: true }))) return;
    await executar(btn, async () => {
      await del(`/admin/categorias/${c.id}`);
      await carregar();
    }, { sucesso: 'Categoria excluida' });
  }

  function abrir(c = null) {
    const bloqueados = c ? descendentes(todas, c.id) : new Set();
    const opcoesPai = [
      { valor: '', rotulo: 'Nenhuma (categoria principal)' },
      ...emArvore(todas)
        .filter((x) => !bloqueados.has(String(x.id)))
        .map((x) => ({ valor: x.id, rotulo: `${'- '.repeat(x.nivel)}${x.nome}` })),
    ];
    const f = {
      nome: campo({ rotulo: 'Nome', nome: 'nome', valor: c?.nome || '', requerido: true }),
      pai: campo({ rotulo: 'Categoria pai', nome: 'pai', tipo: 'select', valor: c?.pai_id ?? '', opcoes: opcoesPai }),
      ordem: campo({ rotulo: 'Ordem de exibicao', nome: 'ordem', tipo: 'number', valor: c?.ordem ?? 0, dica: 'Menor numero aparece primeiro' }),
      bling: campo({ rotulo: 'ID da categoria no Bling', nome: 'bling', tipo: 'number', min: '1', valor: c?.bling_categoria_id ?? '', dica: 'Opcional. Usado ao enviar produtos ao Bling' }),
      ativo: campo({ rotulo: 'Categoria ativa', nome: 'ativo', tipo: 'checkbox', valor: c ? Boolean(c.ativo) : true, full: true }),
    };
    modal({
      titulo: c ? 'Editar categoria' : 'Nova categoria',
      corpo: h('div', { class: 'form-grid' }, f.nome.el, f.pai.el, f.ordem.el, f.bling.el, f.ativo.el),
      acoes: [
        { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
        {
          rotulo: 'Salvar',
          tipo: 'primary',
          aoClicar: async (fechar, btn) => {
            const corpo = {
              nome: f.nome.valor(),
              pai_id: f.pai.input.value || null,
              ordem: Number(f.ordem.input.value || 0),
              bling_categoria_id: f.bling.input.value || null,
              ativo: f.ativo.valor(),
            };
            const ok = await executar(btn, () => (c ? put(`/admin/categorias/${c.id}`, corpo) : post('/admin/categorias', corpo)), { sucesso: c ? 'Categoria atualizada' : 'Categoria criada' });
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
    cabecalhoPagina('Categorias', 'Organizacao da vitrine em categorias e subcategorias.', podeCriar ? botao('Nova categoria', { tipo: 'primary', icon: 'mais', onClick: () => abrir() }) : null),
    alerta('Filtrar pela categoria principal tambem lista os produtos das subcategorias. A exclusao so e permitida para categorias sem produtos.', 'info'),
    cartao(null, area, { plano: true }),
  );
  await carregar();
}
