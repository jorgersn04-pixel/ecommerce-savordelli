// Icones SVG lineares (sem dependencias, sem emojis).
const NS = 'http://www.w3.org/2000/svg';

const ICONES = {
  busca: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm21 21-4.3-4.3' }]],
  sacola: [
    ['path', { d: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z' }],
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M16 10a4 4 0 0 1-8 0' }],
  ],
  pix: [['path', { d: 'M12 2.5 17 7.5 12 12.5 7 7.5zM12 11.5l5 5-5 5-5-5zM2.5 12 6 8.5M2.5 12 6 15.5M21.5 12 18 8.5M21.5 12 18 15.5' }]],
  cartao: [['rect', { x: 2, y: 5, width: 20, height: 14, rx: 2 }], ['path', { d: 'M2 10h20M6 15h4' }]],
  original: [['path', { d: 'M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z' }], ['path', { d: 'm8.5 12 2.5 2.5 4.5-5' }]],
  caminhao: [['path', { d: 'M1 4h13v12H1zM14 8h4l4 4v4h-8' }], ['circle', { cx: 6, cy: 18, r: 2 }], ['circle', { cx: 18, cy: 18, r: 2 }]],
  menos: [['path', { d: 'M5 12h14' }]],
  mais: [['path', { d: 'M12 5v14M5 12h14' }]],
};

export function icone(nome) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icone');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONES[nome] || []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}
