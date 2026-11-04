import { CONFIG } from '../config.js';

export class ApiError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

// Sessao do cliente: o access token fica so em memoria; o refresh token e cookie httpOnly (path /auth/cliente).
// A flag em localStorage indica apenas "ha sessao para tentar restaurar" e evita chamadas inuteis de visitantes.
const FLAG = 'sv_sessao';
let accessToken = null;
let renovando = null;

export const sessaoToken = {
  obter: () => accessToken,
  definir: (t) => {
    accessToken = t;
    if (t) localStorage.setItem(FLAG, '1');
  },
  limpar: () => {
    accessToken = null;
    localStorage.removeItem(FLAG);
  },
  talvezRestauravel: () => localStorage.getItem(FLAG) === '1',
};

async function enviar(metodo, caminho, corpo) {
  const headers = { Accept: 'application/json' };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let resp;
  try {
    resp = await fetch(`${CONFIG.API_BASE}${caminho}`, {
      method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo), credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'REDE', 'Não foi possível conectar. Verifique sua conexão e tente novamente.');
  }
  let dados = null;
  const texto = await resp.text(); // sempre consome o corpo (inclusive 204)
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = null;
    }
  }
  return { ok: resp.ok, status: resp.status, dados };
}

/** Renova o access token pelo cookie de refresh. Chamadas simultaneas compartilham a mesma renovacao. */
export function renovarSessao() {
  renovando ??= (async () => {
    let r = await enviar('POST', '/auth/cliente/refresh');
    if (!r.ok && r.dados?.erro?.codigo === 'REFRESH_CONCORRENTE') {
      // Outra pagina renovou ao mesmo tempo; o cookie novo ja foi gravado: tenta de novo uma vez.
      await new Promise((ok) => setTimeout(ok, 500));
      r = await enviar('POST', '/auth/cliente/refresh');
    }
    if (!r.ok) {
      sessaoToken.limpar();
      return null;
    }
    sessaoToken.definir(r.dados.access_token);
    return r.dados;
  })().finally(() => {
    renovando = null;
  });
  return renovando;
}

function paraErro(r) {
  const e = r.dados?.erro;
  const msg = e?.codigo === 'VALIDACAO' ? 'Confira os dados informados.' : e?.mensagem || 'Não foi possível concluir a operação.';
  return new ApiError(r.status, e?.codigo, msg, e?.detalhes);
}

async function requisitar(metodo, caminho, corpo) {
  let r = await enviar(metodo, caminho, corpo);
  const codigo = r.dados?.erro?.codigo;
  if (r.status === 401 && (codigo === 'TOKEN_EXPIRADO' || codigo === 'TOKEN_AUSENTE') && sessaoToken.talvezRestauravel()) {
    if (await renovarSessao()) r = await enviar(metodo, caminho, corpo);
  }
  if (!r.ok) throw paraErro(r);
  return r.dados;
}

export const get = (c) => requisitar('GET', c);
export const post = (c, b) => requisitar('POST', c, b ?? {});
export const put = (c, b) => requisitar('PUT', c, b ?? {});
export const del = (c) => requisitar('DELETE', c);

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
export const obterCarrinho = (cupom) => get(`/carrinho${querystring({ cupom })}`);
export const adicionarAoCarrinho = (variacaoId, quantidade) => post('/carrinho/itens', { variacao_id: String(variacaoId), quantidade });
export const alterarQuantidade = (variacaoId, quantidade) => put(`/carrinho/itens/${variacaoId}`, { quantidade });
export const removerDoCarrinho = (variacaoId) => del(`/carrinho/itens/${variacaoId}`);
export const cotarFrete = (cep, itens) => post('/frete/cotar', { cep, itens });
export const cotarFreteCarrinho = (cep, cupom) => post('/carrinho/frete', { cep, ...(cupom ? { cupom } : {}) });

// -------------------------------------------------------------- conta do cliente
export const entrar = (email, senha) => post('/auth/cliente/login', { email, senha });
export const cadastrar = (dados) => post('/auth/cliente/registrar', dados);
export const sairDaConta = () => post('/auth/cliente/logout');
export const obterPerfil = () => get('/cliente/me');
export const listarEnderecos = () => get('/cliente/enderecos');
export const criarEndereco = (dados) => post('/cliente/enderecos', dados);

// -------------------------------------------------------------- pedidos e pagamento
export const criarPedido = (dados) => post('/pedidos', dados);
export const pagarPedido = (numero, pagamento) => post(`/pedidos/${encodeURIComponent(numero)}/pagar`, { pagamento });
export const situacaoPagamento = (numero) => get(`/pedidos/${encodeURIComponent(numero)}/pagamento`);
export const obterPedido = (numero) => get(`/pedidos/${encodeURIComponent(numero)}`);
export const cancelarPedido = (numero) => post(`/pedidos/${encodeURIComponent(numero)}/cancelar`);
export const configPagamento = () => get('/pagamentos/config');
export const simularAprovacao = (numero) => post(`/pagamentos/simular/${encodeURIComponent(numero)}/aprovar`);
