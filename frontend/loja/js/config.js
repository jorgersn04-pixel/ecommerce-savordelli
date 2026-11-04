// Configuracao da vitrine.
export const CONFIG = {
  // Usa a API na mesma origem (a vitrine e servida pela propria API em /loja).
  API_BASE: '',

  // Vitrine de demonstracao: enquanto o catalogo estiver VAZIO (ou a API fora do ar), mostra produtos
  // ficticios para validar o layout. Em producao, com produtos cadastrados, nunca e usada.
  // Defina como false para exibir o estado vazio real.
  DEMO_SE_VAZIO: true,

  // Parcelamento exibido (regra de negocio: sem juros). Ajuste conforme a politica da loja.
  PARCELAS_MAX: 12,
  PARCELA_MINIMA: 20, // valor minimo de cada parcela, em reais

  // Marcas revendidas (loja multimarcas). Usadas como fallback quando a API ainda nao tem marcas cadastradas.
  MARCAS_PADRAO: ['Natura', 'Avon', 'Eudora', 'O Boticário', 'Mahogany', "L'Occitane"],

  PRODUTOS_POR_PAGINA: 12,
  DESTAQUES_HOME: 8,
  ESTOQUE_BAIXO: 5, // abaixo disso mostra "Restam N unidades"
};
