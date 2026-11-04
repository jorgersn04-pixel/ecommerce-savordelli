// Componentes de interface. Todo conteudo dinamico entra via textContent/nos de texto: nunca innerHTML,
// o que evita XSS com dados vindos do banco (nomes de produto, observacoes, etc.).
import { icone } from './icons.js';

/** h('div', { class: 'card', onclick: fn }, 'texto', outroNo, [lista]) */
export function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  anexar(el, filhos);
  return el;
}

function anexar(el, filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.appendChild(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

export function limpar(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function montar(container, ...filhos) {
  limpar(container);
  anexar(container, filhos);
}

// ------------------------------------------------------------------ pecas
export const badge = (texto, variante = '') => h('span', { class: `badge ${variante}`.trim() }, texto);

export function badgeDe(mapa, chave) {
  const [rotulo, variante] = mapa[chave] || [chave, ''];
  return badge(rotulo, variante);
}

export function botao(rotulo, { tipo = '', icon, onClick, small = false, type = 'button', disabled = false, titulo } = {}) {
  return h(
    'button',
    { class: `btn ${tipo} ${small ? 'sm' : ''}`.trim(), type, onclick: onClick, disabled, title: titulo, 'aria-label': titulo },
    icon ? icone(icon) : null,
    rotulo,
  );
}

export function cartao(titulo, corpo, { acoes, plano = false } = {}) {
  return h(
    'section',
    { class: 'card' },
    titulo || acoes ? h('div', { class: 'card-head' }, h('h2', {}, titulo || ''), acoes ? h('div', { class: 'row' }, acoes) : null) : null,
    h('div', { class: `card-body ${plano ? 'flush' : ''}`.trim() }, corpo),
  );
}

export function estatistica(rotulo, valor, dica) {
  return h('div', { class: 'card stat' }, h('div', { class: 'stat-label' }, rotulo), h('div', { class: 'stat-value' }, valor), dica ? h('div', { class: 'stat-hint' }, dica) : null);
}

export function carregando(texto = 'Carregando') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner' }), texto);
}

export function vazio(titulo, texto) {
  return h('div', { class: 'empty' }, h('strong', {}, titulo), texto ? h('span', {}, texto) : null);
}

export function alerta(texto, variante = 'info') {
  return h('div', { class: `alert ${variante}`, role: variante === 'danger' ? 'alert' : 'status' }, texto);
}

export function cabecalhoPagina(titulo, descricao, ...acoes) {
  return h(
    'div',
    { class: 'page-head' },
    h('div', {}, h('h2', { class: 'page-title' }, titulo), descricao ? h('p', {}, descricao) : null),
    acoes.length ? h('div', { class: 'page-actions' }, acoes) : null,
  );
}

// ------------------------------------------------------------- formularios
/**
 * Campo rotulado. tipo: text | number | email | password | datetime-local | textarea | select | checkbox.
 * Retorna { el, input, valor() }.
 */
let seq = 0;
export function campo({ rotulo, nome, tipo = 'text', valor = '', opcoes = [], dica, requerido = false, placeholder, passo, min, max, full = false, linhas }) {
  const id = `campo-${nome}-${++seq}`;
  let input;
  if (tipo === 'select') {
    input = h('select', { class: 'select', id, name: nome, required: requerido }, opcoes.map((o) =>
      h('option', { value: o.valor, selected: String(o.valor) === String(valor) }, o.rotulo)));
  } else if (tipo === 'textarea') {
    input = h('textarea', { class: 'textarea', id, name: nome, rows: linhas || 3, placeholder }, valor ?? '');
  } else if (tipo === 'checkbox') {
    input = h('input', { type: 'checkbox', id, name: nome, checked: Boolean(valor) });
    const el = h('div', { class: `field ${full ? 'full' : ''}`.trim() }, h('label', { class: 'check', for: id }, input, rotulo), dica ? h('span', { class: 'hint' }, dica) : null);
    return { el, input, valor: () => input.checked };
  } else {
    input = h('input', { class: 'input', id, name: nome, type: tipo, value: valor ?? '', required: requerido, placeholder, step: passo, min, max, autocomplete: 'off' });
  }
  const el = h('div', { class: `field ${full ? 'full' : ''}`.trim() }, h('label', { for: id }, rotulo), input, dica ? h('span', { class: 'hint' }, dica) : null);
  return {
    el,
    input,
    valor: () => (tipo === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value.trim()),
  };
}

// ------------------------------------------------------------------ tabela
/** colunas: [{ titulo, render(linha) -> Node|string, classe }] */
export function tabela({ colunas, linhas, aoClicar, vazioTitulo = 'Nada por aqui', vazioTexto }) {
  if (!linhas.length) return vazio(vazioTitulo, vazioTexto);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'table' },
      h('thead', {}, h('tr', {}, colunas.map((c) => h('th', { scope: 'col', class: c.classe || '' }, c.titulo)))),
      h(
        'tbody',
        {},
        linhas.map((l) => {
          const tr = h('tr', { class: aoClicar ? 'clickable' : '' }, colunas.map((c) => h('td', { class: c.classe || '' }, c.render(l))));
          if (aoClicar) {
            tr.tabIndex = 0;
            tr.addEventListener('click', () => aoClicar(l));
            tr.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') aoClicar(l);
            });
          }
          return tr;
        }),
      ),
    ),
  );
}

export function paginacao({ pagina, paginas, total, aoMudar }) {
  if (!total) return null;
  return h(
    'div',
    { class: 'pager' },
    h('span', {}, `${total} registro(s) - pagina ${pagina} de ${Math.max(paginas, 1)}`),
    h(
      'div',
      { class: 'row' },
      botao('', { icon: 'esquerda', small: true, titulo: 'Pagina anterior', disabled: pagina <= 1, onClick: () => aoMudar(pagina - 1) }),
      botao('', { icon: 'direita', small: true, titulo: 'Proxima pagina', disabled: pagina >= paginas, onClick: () => aoMudar(pagina + 1) }),
    ),
  );
}

// ------------------------------------------------------------ toast e modal
function raizToasts() {
  let r = document.getElementById('toasts');
  if (!r) {
    r = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(r);
  }
  return r;
}

export function toast(mensagem, tipo = 'ok') {
  const el = h('div', { class: `toast ${tipo}`, role: tipo === 'danger' ? 'alert' : 'status' }, mensagem);
  raizToasts().appendChild(el);
  setTimeout(() => el.remove(), tipo === 'danger' ? 7000 : 4000);
}

/**
 * Dialogo modal acessivel. `corpo` e um Node. `acoes`: [{ rotulo, tipo, aoClicar(fechar) }].
 * Fecha com Esc, clique fora ou botao. Devolve foco ao elemento anterior.
 */
export function modal({ titulo, corpo, acoes = [], largo = false, aoFechar }) {
  const anterior = document.activeElement;
  const fechar = () => {
    document.removeEventListener('keydown', teclas);
    raiz.remove();
    if (anterior && anterior.focus) anterior.focus();
    if (aoFechar) aoFechar();
  };
  const teclas = (e) => {
    if (e.key === 'Escape') fechar();
  };
  const tituloId = `modal-titulo-${++seq}`;
  const raiz = h(
    'div',
    { class: 'modal-root', onclick: (e) => e.target === raiz && fechar() },
    h(
      'div',
      { class: `modal ${largo ? 'wide' : ''}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tituloId },
      h('div', { class: 'modal-head' }, h('h2', { id: tituloId }, titulo), botao('', { tipo: 'ghost', small: true, icon: 'fechar', titulo: 'Fechar', onClick: fechar })),
      h('div', { class: 'modal-body' }, corpo),
      acoes.length
        ? h('div', { class: 'modal-foot' }, acoes.map((a) => botao(a.rotulo, { tipo: a.tipo, onClick: (e) => a.aoClicar(fechar, e.currentTarget) })))
        : null,
    ),
  );
  document.body.appendChild(raiz);
  document.addEventListener('keydown', teclas);
  (raiz.querySelector('input, select, textarea') || raiz.querySelector('.modal-foot button, .modal-head button'))?.focus();
  return { fechar };
}

export function confirmar(mensagem, { rotulo = 'Confirmar', perigo = false, titulo = 'Confirmacao' } = {}) {
  return new Promise((resolve) => {
    // resolve() so vale na primeira chamada: Esc, clique fora ou Cancelar resultam em false.
    modal({
      titulo,
      corpo: h('p', {}, mensagem),
      aoFechar: () => resolve(false),
      acoes: [
        { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
        { rotulo, tipo: perigo ? 'danger' : 'primary', aoClicar: (fechar) => { resolve(true); fechar(); } },
      ],
    });
  });
}

/** Executa uma acao assincrona desabilitando o botao e mostrando erros como toast. */
export async function executar(botaoEl, fn, { sucesso } = {}) {
  if (botaoEl) botaoEl.disabled = true;
  try {
    const r = await fn();
    if (sucesso) toast(sucesso);
    return r;
  } catch (err) {
    toast(err.message || 'Falha na operacao', 'danger');
    return undefined;
  } finally {
    if (botaoEl) botaoEl.disabled = false;
  }
}
