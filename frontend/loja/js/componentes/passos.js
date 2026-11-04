import { h } from '../core/ui.js';

/** Indicador de etapas do fluxo de compra. `atual`: 1 sacola, 2 identificacao, 3 pagamento. */
export function passos(atual) {
  const etapas = ['Sacola', 'Identificação', 'Pagamento'];
  return h(
    'ol',
    { class: 'passos', 'aria-label': 'Etapas da compra' },
    etapas.map((rotulo, i) => h('li', { class: i + 1 < atual ? 'feito' : '', 'aria-current': i + 1 === atual ? 'step' : null }, rotulo)),
  );
}
