import { get, post, put, del, querystring } from '../core/api.js';
import { h, cartao, tabela, paginacao, badgeDe, badge, botao, campo, modal, confirmar, executar, cabecalhoPagina, montar, carregando, alerta } from '../core/ui.js';
import { moeda, numero, STATUS_PRODUTO } from '../core/format.js';
import { temPermissao } from '../core/auth.js';

const OPCOES_STATUS = Object.entries(STATUS_PRODUTO).map(([valor, [rotulo]]) => ({ valor, rotulo }));

// ---------------------------------------------------------------- utilidades
/** "tom: Bege 20" (uma por linha) <-> { tom: 'Bege 20' } */
function lerAtributos(texto) {
  const obj = {};
  for (const linha of texto.split('\n')) {
    const i = linha.indexOf(':');
    if (i > 0 && linha.slice(i + 1).trim()) obj[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
  }
  return Object.keys(obj).length ? obj : null;
}
const atributosParaTexto = (a) => Object.entries(typeof a === 'string' ? JSON.parse(a) : a || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
const resumoAtributos = (a) => Object.values(typeof a === 'string' ? JSON.parse(a) : a || {}).join(' / ') || '-';

/** Bloco de campos de uma variacao (SKU). `coletar()` devolve o payload da API. */
function camposVariacao(v = {}, { edicao = false } = {}) {
  const f = {
    sku: campo({ rotulo: 'SKU', nome: 'sku', valor: v.sku || '', requerido: true }),
    ean: campo({ rotulo: 'EAN / codigo de barras', nome: 'ean', valor: v.ean || '' }),
    preco: campo({ rotulo: 'Preco (R$)', nome: 'preco', tipo: 'number', passo: '0.01', min: '0', valor: v.preco ?? '', requerido: true }),
    promo: campo({ rotulo: 'Preco promocional (R$)', nome: 'promo', tipo: 'number', passo: '0.01', min: '0', valor: v.preco_promocional ?? '', dica: 'Deve ser menor que o preco' }),
    custo: campo({ rotulo: 'Custo (R$)', nome: 'custo', tipo: 'number', passo: '0.01', min: '0', valor: v.custo ?? '' }),
    peso: campo({ rotulo: 'Peso (g)', nome: 'peso', tipo: 'number', min: '1', valor: v.peso_g ?? '', requerido: true }),
    altura: campo({ rotulo: 'Altura (cm)', nome: 'altura', tipo: 'number', passo: '0.01', min: '0', valor: v.altura_cm ?? '', requerido: true }),
    largura: campo({ rotulo: 'Largura (cm)', nome: 'largura', tipo: 'number', passo: '0.01', min: '0', valor: v.largura_cm ?? '', requerido: true }),
    comprimento: campo({ rotulo: 'Comprimento (cm)', nome: 'comprimento', tipo: 'number', passo: '0.01', min: '0', valor: v.comprimento_cm ?? '', requerido: true }),
    atributos: campo({ rotulo: 'Atributos', nome: 'atributos', tipo: 'textarea', linhas: 2, valor: v.atributos ? atributosParaTexto(v.atributos) : '', full: true, dica: 'Um por linha, no formato nome: valor (ex.: tom: Bege 20)' }),
    ativo: edicao ? campo({ rotulo: 'Variacao ativa (vendavel)', nome: 'ativo', tipo: 'checkbox', valor: v.ativo !== 0 && v.ativo !== false }) : null,
  };
  const vazioNulo = (c) => (c.input.value === '' ? null : c.input.value);
  return {
    el: h('div', { class: 'form-grid' }, f.sku.el, f.ean.el, f.preco.el, f.promo.el, f.custo.el, f.peso.el, f.altura.el, f.largura.el, f.comprimento.el, f.atributos.el, f.ativo?.el),
    coletar() {
      return {
        sku: f.sku.input.value.trim(),
        ean: f.ean.input.value.trim() || null,
        preco: f.preco.input.value,
        preco_promocional: vazioNulo(f.promo),
        custo: vazioNulo(f.custo),
        peso_g: Number(f.peso.input.value),
        altura_cm: Number(f.altura.input.value),
        largura_cm: Number(f.largura.input.value),
        comprimento_cm: Number(f.comprimento.input.value),
        atributos: lerAtributos(f.atributos.input.value),
        ...(edicao ? { ativo: f.ativo.input.checked } : {}),
      };
    },
  };
}

function seletorCategorias(categorias, marcadas = []) {
  const porId = new Map(categorias.map((c) => [String(c.id), c]));
  const nome = (c) => (c.pai_id && porId.get(String(c.pai_id)) ? `${porId.get(String(c.pai_id)).nome} / ${c.nome}` : c.nome);
  const checks = categorias.map((c) => {
    const input = h('input', { type: 'checkbox', value: c.id, checked: marcadas.includes(String(c.id)) });
    return { input, el: h('label', { class: 'check' }, input, nome(c)) };
  });
  return {
    el: h('div', { class: 'field full' }, h('span', { class: 'field-label' }, 'Categorias'), checks.length ? h('div', { class: 'checks' }, checks.map((c) => c.el)) : h('span', { class: 'muted' }, 'Nenhuma categoria cadastrada.')),
    valores: () => checks.filter((c) => c.input.checked).map((c) => String(c.input.value)),
  };
}

function camposProduto(p = {}, marcas, categorias) {
  const f = {
    nome: campo({ rotulo: 'Nome', nome: 'nome', valor: p.nome || '', requerido: true, full: true }),
    marca: campo({ rotulo: 'Marca', nome: 'marca', tipo: 'select', valor: p.marca_id ?? '', opcoes: [{ valor: '', rotulo: 'Sem marca' }, ...marcas.map((m) => ({ valor: m.id, rotulo: m.nome }))] }),
    status: campo({ rotulo: 'Situacao', nome: 'status', tipo: 'select', valor: p.status || 'rascunho', opcoes: OPCOES_STATUS, dica: 'So produtos ativos aparecem na loja' }),
    curta: campo({ rotulo: 'Descricao curta', nome: 'curta', valor: p.descricao_curta || '', full: true }),
    descricao: campo({ rotulo: 'Descricao completa', nome: 'descricao', tipo: 'textarea', linhas: 5, valor: p.descricao || '', full: true }),
    ncm: campo({ rotulo: 'NCM', nome: 'ncm', valor: p.ncm || '', dica: '8 digitos (necessario para NF-e)' }),
    origem: campo({ rotulo: 'Origem fiscal', nome: 'origem', tipo: 'number', min: '0', max: '8', valor: p.origem_fiscal ?? '' }),
  };
  const cats = seletorCategorias(categorias, p.categorias_ids || []);
  return {
    el: h('div', { class: 'form-grid' }, f.nome.el, f.marca.el, f.status.el, f.curta.el, f.descricao.el, f.ncm.el, f.origem.el, cats.el),
    coletar() {
      return {
        nome: f.nome.input.value.trim(),
        marca_id: f.marca.input.value || null,
        status: f.status.input.value,
        descricao_curta: f.curta.input.value.trim() || null,
        descricao: f.descricao.input.value.trim() || null,
        ncm: f.ncm.input.value.trim() || null,
        origem_fiscal: f.origem.input.value === '' ? null : Number(f.origem.input.value),
        categorias_ids: cats.valores(),
      };
    },
  };
}

// ---------------------------------------------------------------------- lista
export async function lista(container, { navegar }) {
  const estado = { q: '', status: '', pagina: 1 };
  const area = h('div', { class: 'card' });

  async function carregar() {
    montar(area, carregando());
    const r = await get(`/admin/produtos${querystring({ ...estado, limite: 20 })}`);
    montar(
      area,
      tabela({
        colunas: [
          { titulo: 'Produto', render: (p) => h('div', {}, h('div', { class: 'cell-main' }, p.nome), h('div', { class: 'cell-sub mono' }, p.slug)) },
          { titulo: 'Situacao', render: (p) => badgeDe(STATUS_PRODUTO, p.status) },
          { titulo: 'Variacoes', classe: 'right', render: (p) => numero(p.variacoes) },
          { titulo: 'Estoque', classe: 'right', render: (p) => h('strong', {}, numero(p.estoque_total)) },
          { titulo: 'Bling', render: (p) => (p.bling_produto_id ? `#${p.bling_produto_id}` : h('span', { class: 'faint' }, 'por SKU')) },
        ],
        linhas: r.itens,
        aoClicar: (p) => navegar(`/produtos/${p.id}`),
        vazioTitulo: 'Nenhum produto encontrado',
        vazioTexto: 'Cadastre o primeiro produto para comecar a vender.',
      }),
      paginacao({ ...r.paginacao, aoMudar: (p) => { estado.pagina = p; carregar(); } }),
    );
  }

  const fStatus = campo({ rotulo: 'Situacao', nome: 'status', tipo: 'select', opcoes: [{ valor: '', rotulo: 'Todas' }, ...OPCOES_STATUS] });
  const fBusca = campo({ rotulo: 'Buscar', nome: 'q', placeholder: 'Nome ou SKU' });
  fStatus.input.addEventListener('change', () => { estado.status = fStatus.input.value; estado.pagina = 1; carregar(); });
  fBusca.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { estado.q = fBusca.input.value.trim(); estado.pagina = 1; carregar(); }
  });

  container.append(
    cabecalhoPagina('Produtos', 'Catalogo da loja. O estoque e espelhado do Bling.', temPermissao('produtos.criar') ? botao('Novo produto', { tipo: 'primary', icon: 'mais', onClick: () => navegar('/produtos/novo') }) : null),
    h('div', { class: 'filters' }, fStatus.el, fBusca.el),
    area,
  );
  await carregar();
}

// ----------------------------------------------------------------------- novo
export async function novo(container, { navegar }) {
  const [{ itens: marcas }, { itens: categorias }] = await Promise.all([get('/admin/marcas'), get('/admin/categorias')]);
  const produto = camposProduto({}, marcas, categorias);
  const imagens = campo({ rotulo: 'Imagens (URLs)', nome: 'imagens', tipo: 'textarea', linhas: 3, full: true, dica: 'Uma URL https por linha. A primeira sera a imagem principal.' });

  const listaVar = h('div', { class: 'stack' });
  const variacoes = [];
  function adicionarVariacao() {
    const v = camposVariacao();
    variacoes.push(v);
    const bloco = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, `Variacao ${variacoes.length}`), variacoes.length > 1 ? botao('Remover', { small: true, tipo: 'ghost', icon: 'lixeira', onClick: () => { variacoes.splice(variacoes.indexOf(v), 1); bloco.remove(); } }) : null),
      h('div', { class: 'card-body' }, v.el),
    );
    listaVar.appendChild(bloco);
  }
  adicionarVariacao();

  const form = h(
    'form',
    { class: 'stack', novalidate: true },
    cartao('Dados do produto', produto.el),
    h('div', { class: 'row between' }, h('h2', {}, 'Variacoes (SKUs)'), botao('Adicionar variacao', { icon: 'mais', onClick: adicionarVariacao })),
    listaVar,
    cartao('Imagens', h('div', { class: 'form-grid' }, imagens.el)),
    h('div', { class: 'row' }, botao('Salvar produto', { tipo: 'primary', type: 'submit' }), botao('Cancelar', { onClick: () => navegar('/produtos') })),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const urls = imagens.input.value.split('\n').map((s) => s.trim()).filter(Boolean);
    const corpo = {
      ...produto.coletar(),
      variacoes: variacoes.map((v) => v.coletar()),
      imagens: urls.map((url, i) => ({ url, ordem: i, principal: i === 0 })),
    };
    const criado = await executar(form.querySelector('[type=submit]'), () => post('/admin/produtos', corpo), { sucesso: 'Produto criado' });
    if (criado) navegar(`/produtos/${criado.id}`);
  });

  container.append(cabecalhoPagina('Novo produto', 'Todo produto precisa de ao menos uma variacao (SKU) vendavel.'), form);
}

// -------------------------------------------------------------------- detalhe
export async function detalhe(container, { params, titulo, navegar }) {
  const id = params[0];
  const raiz = h('div', { class: 'stack' });
  container.append(raiz);
  const podeEditar = temPermissao('produtos.editar');
  const podeEstoque = temPermissao('estoque.ajustar');

  async function carregar() {
    const [p, { itens: marcas }, { itens: categorias }] = await Promise.all([get(`/admin/produtos/${id}`), get('/admin/marcas'), get('/admin/categorias')]);
    titulo(p.nome);
    const dados = camposProduto(p, marcas, categorias);
    if (!podeEditar) dados.el.querySelectorAll('input, select, textarea').forEach((el) => { el.disabled = true; });

    montar(
      raiz,
      cabecalhoPagina(
        p.nome,
        h('span', {}, badgeDe(STATUS_PRODUTO, p.status), ' ', h('span', { class: 'mono faint' }, p.slug)),
        botao('Voltar', { icon: 'voltar', onClick: () => navegar('/produtos') }),
        temPermissao('produtos.excluir')
          ? botao('Excluir', {
              tipo: 'danger',
              icon: 'lixeira',
              onClick: async (e) => {
                if (!(await confirmar('Excluir este produto? Ele sai da loja e as variacoes sao desativadas.', { rotulo: 'Excluir', perigo: true }))) return;
                const ok = await executar(e.currentTarget, () => del(`/admin/produtos/${id}`), { sucesso: 'Produto excluido' });
                if (ok !== undefined) navegar('/produtos');
              },
            })
          : null,
      ),
      cartao(
        'Dados do produto',
        h(
          'div',
          { class: 'stack' },
          dados.el,
          podeEditar
            ? h('div', {}, botao('Salvar alteracoes', {
                tipo: 'primary',
                onClick: (e) =>
                  executar(e.currentTarget, async () => {
                    await put(`/admin/produtos/${id}`, dados.coletar());
                    await carregar();
                  }, { sucesso: 'Produto atualizado' }),
              }))
            : null,
        ),
      ),
      cartao(
        'Variacoes e estoque',
        tabela({
          colunas: [
            { titulo: 'SKU', render: (v) => h('div', {}, h('div', { class: 'cell-main mono' }, v.sku), h('div', { class: 'cell-sub' }, resumoAtributos(v.atributos))) },
            { titulo: 'Preco', classe: 'right nowrap', render: (v) => (v.preco_promocional && Number(v.preco_promocional) < Number(v.preco) ? h('div', {}, h('strong', {}, moeda(v.preco_promocional)), h('div', { class: 'cell-sub' }, `de ${moeda(v.preco)}`)) : h('strong', {}, moeda(v.preco))) },
            { titulo: 'Disponivel', classe: 'right', render: (v) => h('div', {}, h('strong', {}, numero(v.estoque_disponivel)), v.estoque_reservado ? h('div', { class: 'cell-sub' }, `${v.estoque_reservado} reservado(s)`) : null) },
            { titulo: 'Situacao', render: (v) => (v.ativo ? badge('Ativa', 'ok') : badge('Inativa', 'danger')) },
            { titulo: 'Bling', render: (v) => (v.bling_variacao_id ? h('span', { class: 'mono' }, `#${v.bling_variacao_id}`) : h('span', { class: 'faint' }, 'pendente')) },
            {
              titulo: '',
              classe: 'right nowrap',
              render: (v) => h('div', { class: 'row' }, podeEditar ? botao('Editar', { small: true, icon: 'editar', onClick: () => editarVariacao(v) }) : null, podeEstoque ? botao('Estoque', { small: true, onClick: () => ajustarEstoque(v) }) : null),
            },
          ],
          linhas: p.variacoes,
        }),
        { plano: true, acoes: podeEditar ? botao('Nova variacao', { small: true, icon: 'mais', onClick: novaVariacao }) : null },
      ),
      cartao(
        'Imagens',
        h(
          'div',
          { class: 'stack' },
          p.imagens.length
            ? h('div', { class: 'thumbs' }, p.imagens.map((img) =>
                h('figure', { class: 'thumb-item' },
                  h('img', { class: 'thumb', src: img.url, alt: img.texto_alternativo || p.nome, loading: 'lazy', referrerpolicy: 'no-referrer' }),
                  h('figcaption', { class: 'row between' }, img.principal ? badge('Principal', 'info') : h('span', {}), podeEditar ? botao('', { small: true, tipo: 'ghost', icon: 'lixeira', titulo: 'Remover imagem', onClick: (e) => executar(e.currentTarget, async () => { await del(`/admin/imagens/${img.id}`); await carregar(); }, { sucesso: 'Imagem removida' }) }) : null))))
            : alerta('Nenhuma imagem cadastrada.', 'warn'),
          podeEditar ? formImagem() : null,
        ),
      ),
    );

    function formImagem() {
      const url = campo({ rotulo: 'Adicionar imagem (URL https)', nome: 'url', placeholder: 'https://...' });
      return h('div', { class: 'row' }, h('div', { class: 'field' }, url.el), botao('Adicionar', {
        onClick: (e) => executar(e.currentTarget, async () => {
          await post(`/admin/produtos/${id}/imagens`, { url: url.input.value.trim() });
          await carregar();
        }, { sucesso: 'Imagem adicionada' }),
      }));
    }

    function editarVariacao(v) {
      const f = camposVariacao(v, { edicao: true });
      modal({
        titulo: `Editar variacao ${v.sku}`,
        largo: true,
        corpo: f.el,
        acoes: [
          { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
          { rotulo: 'Salvar', tipo: 'primary', aoClicar: async (fechar, btn) => {
            const ok = await executar(btn, () => put(`/admin/variacoes/${v.id}`, f.coletar()), { sucesso: 'Variacao atualizada' });
            if (ok) { fechar(); await carregar(); }
          } },
        ],
      });
    }

    function novaVariacao() {
      const f = camposVariacao();
      modal({
        titulo: 'Nova variacao',
        largo: true,
        corpo: f.el,
        acoes: [
          { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
          { rotulo: 'Criar', tipo: 'primary', aoClicar: async (fechar, btn) => {
            const ok = await executar(btn, () => post(`/admin/produtos/${id}/variacoes`, f.coletar()), { sucesso: 'Variacao criada' });
            if (ok) { fechar(); await carregar(); }
          } },
        ],
      });
    }

    function ajustarEstoque(v) {
      const saldo = campo({ rotulo: 'Novo saldo (unidades)', nome: 'saldo', tipo: 'number', min: '0', valor: v.estoque_disponivel, requerido: true });
      modal({
        titulo: `Estoque - ${v.sku}`,
        corpo: h('div', { class: 'stack' },
          alerta('O Bling e a fonte absoluta do estoque. Este ajuste e enviado ao Bling e podera ser sobrescrito pelo saldo de la.', 'info'),
          saldo.el,
          h('p', { class: 'muted' }, `Reservado por pedidos em aberto: ${v.estoque_reservado}`)),
        acoes: [
          { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
          { rotulo: 'Ajustar', tipo: 'primary', aoClicar: async (fechar, btn) => {
            const ok = await executar(btn, () => put(`/admin/variacoes/${v.id}/estoque`, { saldo: Number(saldo.input.value) }), { sucesso: 'Estoque ajustado' });
            if (ok) { fechar(); await carregar(); }
          } },
        ],
      });
    }
  }

  await carregar();
}
