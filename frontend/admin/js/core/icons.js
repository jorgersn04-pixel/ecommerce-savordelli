// Icones SVG lineares (sem dependencias, sem emojis). Cada icone = lista de [tag, atributos].
const NS = 'http://www.w3.org/2000/svg';

const ICONES = {
  dashboard: [
    ['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }],
  ],
  pedidos: [
    ['path', { d: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z' }],
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M16 10a4 4 0 0 1-8 0' }],
  ],
  produtos: [
    ['path', { d: 'M21 8l-9-5-9 5v8l9 5 9-5z' }],
    ['path', { d: 'M3.3 7.5 12 12l8.7-4.5' }],
    ['path', { d: 'M12 12v9' }],
  ],
  cupons: [
    ['path', { d: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z' }],
    ['circle', { cx: 7, cy: 7, r: 1 }],
  ],
  bling: [
    ['path', { d: 'M21 12a9 9 0 0 0-15-6.7L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
    ['path', { d: 'M3 12a9 9 0 0 0 15 6.7L21 16' }],
    ['path', { d: 'M16 16h5v5' }],
  ],
  marcas: [
    ['path', { d: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z' }],
  ],
  categorias: [
    ['path', { d: 'M3 6h4v4H3zM3 14h4v4H3zM10 8h11M10 16h11M7 8h0M7 16h0' }],
  ],
  menu: [['path', { d: 'M3 6h18M3 12h18M3 18h18' }]],
  sair: [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
    ['path', { d: 'M16 17l5-5-5-5' }],
    ['path', { d: 'M21 12H9' }],
  ],
  mais: [['path', { d: 'M12 5v14M5 12h14' }]],
  fechar: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  busca: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['path', { d: 'm21 21-4.3-4.3' }],
  ],
  esquerda: [['path', { d: 'm15 18-6-6 6-6' }]],
  direita: [['path', { d: 'm9 18 6-6-6-6' }]],
  voltar: [['path', { d: 'M19 12H5M12 19l-7-7 7-7' }]],
  alerta: [
    ['path', { d: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' }],
    ['path', { d: 'M12 9v4M12 17h.01' }],
  ],
  lixeira: [
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }],
    ['path', { d: 'M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' }],
  ],
  editar: [
    ['path', { d: 'M12 20h9' }],
    ['path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' }],
  ],
};

export function icone(nome) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONES[nome] || []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}
