// Cliente da API. O access token vive apenas em memoria; o refresh token e um cookie httpOnly
// (inacessivel ao JavaScript). Em 401 por expiracao, renova uma vez e repete a requisicao.

export class ApiError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

let accessToken = null;
let renovando = null;

export const token = {
  obter: () => accessToken,
  definir: (t) => {
    accessToken = t;
  },
};

function mensagemAmigavel(corpo, status) {
  const e = corpo?.erro;
  if (!e) return `Erro inesperado (${status})`;
  if (e.codigo === 'VALIDACAO' && Array.isArray(e.detalhes)) {
    return e.detalhes.map((d) => `${(d.path || []).join('.') || 'campo'}: ${d.message}`).join(' | ');
  }
  return e.mensagem || `Erro (${status})`;
}

async function enviar(metodo, caminho, corpo) {
  const headers = { Accept: 'application/json' };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let resp;
  try {
    resp = await fetch(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'REDE', 'Sem conexao com o servidor');
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

/** Renova o access token a partir do cookie de refresh. Chamadas simultaneas compartilham a mesma renovacao. */
export function renovar() {
  renovando ??= (async () => {
    let r = await enviar('POST', '/auth/admin/refresh');
    if (!r.ok && r.dados?.erro?.codigo === 'REFRESH_CONCORRENTE') {
      // Outra pagina renovou ao mesmo tempo; o cookie novo ja foi gravado: tenta de novo uma vez.
      await new Promise((ok) => setTimeout(ok, 500));
      r = await enviar('POST', '/auth/admin/refresh');
    }
    if (!r.ok) {
      accessToken = null;
      return null;
    }
    accessToken = r.dados.access_token;
    return r.dados;
  })().finally(() => {
    renovando = null;
  });
  return renovando;
}

export async function api(metodo, caminho, corpo) {
  let r = await enviar(metodo, caminho, corpo);
  const codigo = r.dados?.erro?.codigo;
  if (r.status === 401 && (codigo === 'TOKEN_EXPIRADO' || codigo === 'TOKEN_AUSENTE')) {
    if (await renovar()) r = await enviar(metodo, caminho, corpo);
    else window.dispatchEvent(new CustomEvent('sessao-expirada'));
  }
  if (!r.ok) throw new ApiError(r.status, r.dados?.erro?.codigo, mensagemAmigavel(r.dados, r.status), r.dados?.erro?.detalhes);
  return r.dados;
}

export const get = (c) => api('GET', c);
export const post = (c, b) => api('POST', c, b ?? {});
export const put = (c, b) => api('PUT', c, b ?? {});
export const del = (c) => api('DELETE', c);

export function querystring(obj) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}
