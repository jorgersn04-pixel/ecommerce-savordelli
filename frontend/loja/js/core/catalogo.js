// Acesso ao catalogo com fallback de demonstracao (somente se CONFIG.DEMO_SE_VAZIO e o catalogo real estiver vazio).
import { CONFIG } from '../config.js';
import { listarProdutos, obterProduto, listarCategorias, listarMarcas, ApiError } from './api.js';
import { slugify } from './format.js';
import { listaDemo, detalheDemo, CATEGORIAS_DEMO } from '../mock.js';

const CHAVE = 'sv_demo';
const emDemo = () => CONFIG.DEMO_SE_VAZIO && sessionStorage.getItem(CHAVE) === '1';
const ligarDemo = () => sessionStorage.setItem(CHAVE, '1');
const desligarDemo = () => sessionStorage.removeItem(CHAVE);
const falhaDeServidor = (e) => e instanceof ApiError && (e.codigo === 'REDE' || e.status >= 500);

/** Retorna { itens, paginacao, demo }. A requisicao a API e sempre feita primeiro. */
export async function buscarLista(filtros) {
  const semFiltro = !filtros.q && !filtros.categoria && !filtros.marca;
  try {
    const r = await listarProdutos(filtros);
    if (r.paginacao.total === 0 && CONFIG.DEMO_SE_VAZIO && (semFiltro || emDemo())) {
      ligarDemo();
      return { ...listaDemo(filtros), demo: true };
    }
    if (r.paginacao.total > 0) desligarDemo();
    return { ...r, demo: false };
  } catch (e) {
    if (CONFIG.DEMO_SE_VAZIO && falhaDeServidor(e)) {
      ligarDemo();
      return { ...listaDemo(filtros), demo: true };
    }
    throw e;
  }
}

/** Retorna { produto, demo } ou lanca ApiError (404 quando nao existe). */
export async function buscarProduto(slug) {
  if (CONFIG.DEMO_SE_VAZIO && slug.startsWith('demo-')) {
    const p = detalheDemo(slug);
    if (p) return { produto: p, demo: true };
  }
  return { produto: await obterProduto(slug), demo: false };
}

/** Marcas ativas. Sem marcas cadastradas (ou API fora), usa as marcas padrao da loja. */
export async function buscarMarcas() {
  const padrao = CONFIG.MARCAS_PADRAO.map((nome, i) => ({ id: `padrao-${i}`, nome, slug: slugify(nome) }));
  try {
    const { itens } = await listarMarcas();
    return itens.length ? itens : padrao;
  } catch {
    return padrao;
  }
}

export async function buscarCategorias() {
  try {
    const { itens } = await listarCategorias();
    if (itens.length === 0 && emDemo()) return { itens: CATEGORIAS_DEMO, demo: true };
    return { itens, demo: false };
  } catch (e) {
    if (emDemo()) return { itens: CATEGORIAS_DEMO, demo: true };
    throw e;
  }
}
