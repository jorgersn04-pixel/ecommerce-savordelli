'use strict';

const net = require('net');

/**
 * Converte IP textual em Buffer para a coluna VARBINARY(16).
 * IPv4 (e IPv4 mapeado em IPv6) vira 4 bytes; IPv6 puro vira 16 bytes.
 */
function ipParaBuffer(ip) {
  if (!ip) return null;
  const limpo = ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  if (net.isIPv4(limpo)) return Buffer.from(limpo.split('.').map(Number));
  if (net.isIPv6(limpo)) {
    const [cabeca, cauda = ''] = limpo.split('::');
    const parse = (s) => (s ? s.split(':') : []);
    const a = parse(cabeca);
    const b = limpo.includes('::') ? parse(cauda) : [];
    const grupos = limpo.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
    const buf = Buffer.alloc(16);
    grupos.forEach((g, i) => buf.writeUInt16BE(parseInt(g || '0', 16), i * 2));
    return buf;
  }
  return null;
}

module.exports = { ipParaBuffer };
