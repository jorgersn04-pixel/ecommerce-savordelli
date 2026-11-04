// Helpers de DOM. Todo conteudo dinamico entra como texto (nunca innerHTML): nomes e descricoes vem do
// banco e nao podem ser interpretados como HTML.

/** h('div', { class: 'x', onclick: fn }, 'texto', no, [lista]) */
export function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
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

export function montar(container, ...filhos) {
  while (container.firstChild) container.removeChild(container.firstChild);
  anexar(container, filhos);
}

let timerToast;
export function toast(mensagem, tipo = 'sucesso') {
  document.querySelector('.toast')?.remove();
  clearTimeout(timerToast);
  const el = h('div', { class: `toast ${tipo === 'erro' ? 'erro' : ''}`.trim(), role: tipo === 'erro' ? 'alert' : 'status' }, mensagem);
  document.body.appendChild(el);
  timerToast = setTimeout(() => el.remove(), 4500);
}
