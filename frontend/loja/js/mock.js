// Dados de DEMONSTRACAO. So sao usados quando o catalogo real esta vazio (ver CONFIG.DEMO_SE_VAZIO).
// Sem imagens externas: a vitrine desenha um placeholder com a inicial do produto.
const v = (id, sku, atributos, preco, promo, disponivel = 12) => ({
  id: `demo-${id}`, sku, atributos, preco, preco_promocional: promo, peso_g: 300, disponivel,
});

export const CATEGORIAS_DEMO = [
  { id: 'demo-c1', pai_id: null, nome: 'Perfumaria', slug: 'demo-perfumaria' },
  { id: 'demo-c2', pai_id: null, nome: 'Maquiagem', slug: 'demo-maquiagem' },
  { id: 'demo-c3', pai_id: null, nome: 'Cuidados com a pele', slug: 'demo-pele' },
  { id: 'demo-c4', pai_id: null, nome: 'Cabelos', slug: 'demo-cabelos' },
];

const P = (id, nome, marca, categoria, curta, variacoes) => ({
  id: `demo-${id}`,
  nome,
  slug: `demo-${nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  marca_nome: marca,
  marca_slug: 'demo',
  descricao_curta: curta,
  descricao:
    `${curta}\n\nProduto de demonstração exibido porque o catálogo ainda está vazio. Cadastre produtos no painel administrativo para que a vitrine mostre os itens reais da loja.`,
  categoria,
  variacoes,
  imagens: [],
});

export const PRODUTOS_DEMO = [
  P(1, 'Água de Colônia Floral', 'Savordelli Demo', 'demo-perfumaria', 'Fragrância floral delicada para o dia a dia.', [
    v(11, 'DEMO-AC-50', { volume: '50ml' }, '89.90', '71.90'), v(12, 'DEMO-AC-100', { volume: '100ml' }, '139.90', null),
  ]),
  P(2, 'Batom Matte Longa Duração', 'Savordelli Demo', 'demo-maquiagem', 'Cor intensa com acabamento matte confortável.', [
    v(21, 'DEMO-BT-RS', { tom: 'Rosa' }, '49.90', null), v(22, 'DEMO-BT-VM', { tom: 'Vermelho' }, '49.90', null, 0),
  ]),
  P(3, 'Hidratante Corporal Nutritivo', 'Savordelli Demo', 'demo-pele', 'Hidratação profunda com toque seco.', [v(31, 'DEMO-HC-200', { volume: '200ml' }, '39.90', '29.90')]),
  P(4, 'Sérum Facial Vitamina C', 'Savordelli Demo', 'demo-pele', 'Uniformiza e ilumina a pele com uso diario.', [v(41, 'DEMO-SV-30', { volume: '30ml' }, '119.90', '95.90', 4)]),
  P(5, 'Máscara de Cílios Volume', 'Savordelli Demo', 'demo-maquiagem', 'Volume e definição sem pesar.', [v(51, 'DEMO-MC-01', { cor: 'Preta' }, '59.90', null)]),
  P(6, 'Base Líquida Cobertura Média', 'Savordelli Demo', 'demo-maquiagem', 'Acabamento natural e longa duração.', [
    v(61, 'DEMO-BL-20', { tom: 'Bege 20' }, '79.90', null), v(62, 'DEMO-BL-30', { tom: 'Bege 30' }, '79.90', null), v(63, 'DEMO-BL-40', { tom: 'Bege 40' }, '79.90', null),
  ]),
  P(7, 'Shampoo Reparador', 'Savordelli Demo', 'demo-cabelos', 'Limpa e recupera fios ressecados.', [v(71, 'DEMO-SH-300', { volume: '300ml' }, '34.90', '27.90')]),
  P(8, 'Perfume Amadeirado Intenso', 'Savordelli Demo', 'demo-perfumaria', 'Notas de madeira e âmbar para a noite.', [v(81, 'DEMO-PA-100', { volume: '100ml' }, '219.90', '175.90')]),
];

const menorPreco = (p) => Math.min(...p.variacoes.map((x) => Number(x.preco_promocional && Number(x.preco_promocional) < Number(x.preco) ? x.preco_promocional : x.preco)));
const menorCheio = (p) => Math.min(...p.variacoes.map((x) => Number(x.preco)));

/** Mesmo formato de GET /catalogo/produtos. */
export function listaDemo({ q, categoria, ordem = 'recentes', pagina = 1, limite = 12 } = {}) {
  let itens = PRODUTOS_DEMO.filter((p) => (!q || p.nome.toLowerCase().includes(String(q).toLowerCase())) && (!categoria || p.categoria === categoria));
  const preco = (p) => menorPreco(p);
  if (ordem === 'preco_asc') itens = [...itens].sort((a, b) => preco(a) - preco(b));
  if (ordem === 'preco_desc') itens = [...itens].sort((a, b) => preco(b) - preco(a));
  if (ordem === 'nome') itens = [...itens].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const total = itens.length;
  const pg = Number(pagina);
  const fatia = itens.slice((pg - 1) * limite, pg * limite).map((p) => ({
    id: p.id, nome: p.nome, slug: p.slug, descricao_curta: p.descricao_curta,
    marca_nome: p.marca_nome, marca_slug: p.marca_slug,
    preco_min: String(menorPreco(p).toFixed(2)), preco_cheio_min: String(menorCheio(p).toFixed(2)),
    disponivel: p.variacoes.some((x) => x.disponivel > 0), imagem: null,
  }));
  return { itens: fatia, paginacao: { pagina: pg, limite, total, paginas: Math.ceil(total / limite) } };
}

/** Mesmo formato de GET /catalogo/produtos/:slug. */
export function detalheDemo(slug) {
  const p = PRODUTOS_DEMO.find((x) => x.slug === slug);
  if (!p) return null;
  const cat = CATEGORIAS_DEMO.find((c) => c.slug === p.categoria);
  return { ...p, categorias: cat ? [{ id: cat.id, nome: cat.nome, slug: cat.slug }] : [] };
}
