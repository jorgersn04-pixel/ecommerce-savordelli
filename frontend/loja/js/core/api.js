import { CONFIG } from '../config.js';

export class ApiError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

async function requisitar(metodo, caminho, corpo) {
  let resp;
  try {
    resp = await fetch(`${CONFIG.API_BASE}${caminho}`, {
      method: metodo,
      headers: { Accept: 'application/json', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      credentials: 'same-origin', // cookie do carrinho
    });
  } catch {
    throw new ApiError(0, 'REDE', 'Nao foi possivel conectar. Verifique sua conexao e tente novamente.');
  }
  let dados = null;
  try {
    dados = await resp.json();
  } catch {
    dados = null;
  }
  if (!resp.ok) {
    const e = dados?.erro;
    const msg = e?.codigo === 'VALIDACAO' ? 'Confira os dados informados.' : e?.mensagem || 'Nao foi possivel concluir a operacao.';
    throw new ApiError(resp.status, e?.codigo, msg, e?.detalhes);
  }
  return dados;
}

export const get = (c) => requisitar('GET', c);
export const post = (c, b) => requisitar('POST', c, b ?? {});

export function querystring(obj) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

// -------------------------------------------------------------- catalogo
export const listarProdutos = (filtros) => get(`/catalogo/produtos${querystring(filtros)}`);
export const obterProduto = (slug) => get(`/catalogo/produtos/${encodeURIComponent(slug)}`);
export const listarCategorias = () => get('/catalogo/categorias');
export const listarMarcas = () => get('/catalogo/marcas');

// -------------------------------------------------------------- carrinho e frete
export const obterCarrinho = () => get('/carrinho');
export const adicionarAoCarrinho = (variacaoId, quantidade) => post('/carrinho/itens', { variacao_id: String(variacaoId), quantidade });
export const cotarFrete = (cep, itens) => post('/frete/cotar', { cep, itens });
