import { CONFIG } from './config.js';
import { h, montar, toast } from './core/ui.js';
import { icone } from './core/icones.js';
import { buscarProduto } from './core/catalogo.js';
import { adicionarAoCarrinho, cotarFrete, ApiError } from './core/api.js';
import { moeda, percentualDesconto, textoParcelamento, rotuloVariacao, formatarCep, plural, textoOriginal } from './core/format.js';
import { imagemProduto } from './componentes/card-produto.js';
import { montarCasca } from './shell.js';

const casca = montarCasca();
const principal = document.getElementById('principal');
const slug = new URLSearchParams(window.location.search).get('slug') || '';

const precoEfetivo = (v) => (v.preco_promocional && Number(v.preco_promocional) < Number(v.preco) ? v.preco_promocional : v.preco);

function telaErro(titulo, texto) {
  montar(
    principal,
    h('div', { class: 'container secao' }, h('div', { class: 'vazio' }, h('strong', {}, titulo), h('p', {}, texto), h('p', {}, h('a', { class: 'link-sutil', href: './' }, 'Voltar para a página inicial')))),
  );
}

/** Faixa de confianca junto ao botao de compra. */
function faixaConfianca(marca) {
  const item = (ic, titulo, sub) => h('li', {}, icone(ic), h('span', {}, titulo, h('small', {}, sub)));
  return h(
    'ul',
    { class: 'faixa-confianca', 'aria-label': 'Garantias da compra' },
    item('pix', 'Pague com Pix', 'Aprovação imediata'),
    item('cartao', `Em até ${CONFIG.PARCELAS_MAX}x sem juros`, 'No cartão de crédito'),
    item('original', textoOriginal(marca), 'Procedência garantida'),
  );
}

async function iniciar() {
  if (!slug) {
    telaErro('Produto não informado', 'O endereço acessado não indica qual produto exibir.');
    return;
  }

  montar(principal, h('div', { class: 'container' }, h('div', { class: 'produto' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }))));

  let resultado;
  try {
    resultado = await buscarProduto(slug);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) telaErro('Produto não encontrado', 'Ele pode ter sido removido ou o endereço está incorreto.');
    else telaErro('Não foi possível carregar o produto', e.message);
    casca.carregarCategorias();
    casca.carregarMarcas();
    return;
  }
  const { produto, demo } = resultado;
  document.title = `${produto.nome} | Savordelli`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', produto.descricao_curta || produto.nome);

  const variacoes = produto.variacoes;
  const estado = { variacao: variacoes.find((v) => v.disponivel > 0) || variacoes[0], quantidade: 1, imagem: 0 };
  const imagens = produto.imagens || [];

  // ---------------------------------------------------------------- galeria
  const principalImg = h('div', { class: 'galeria-principal' });
  const seloGaleria = h('span', { class: 'selo-desconto', hidden: true });
  const miniaturas = h('ul', { class: 'miniaturas', 'aria-label': 'Imagens do produto' });

  function renderGaleria() {
    const img = imagens[estado.imagem];
    montar(principalImg, seloGaleria, imagemProduto(img?.url, img?.texto_alternativo || produto.nome, { eager: true }));
    montar(
      miniaturas,
      imagens.length > 1
        ? imagens.map((im, i) =>
            h('li', {}, h('button', { class: 'miniatura', type: 'button', 'aria-label': `Ver imagem ${i + 1}`, 'aria-current': i === estado.imagem ? 'true' : null, onclick: () => { estado.imagem = i; renderGaleria(); atualizarPreco(); } }, imagemProduto(im.url, im.texto_alternativo || produto.nome))))
        : null,
    );
  }

  // ---------------------------------------------------------------- preco, estoque e acoes
  const blocoPreco = h('div', { class: 'bloco-preco' });
  const estoqueAviso = h('p', { class: 'estoque-aviso', 'aria-live': 'polite' });
  const botoesVariacao = h('ul', { class: 'chips', role: 'group', 'aria-label': 'Opções' });
  const grupoVariacao = h('div', { class: 'campo-grupo' });
  const qtdValor = h('output', { 'aria-live': 'polite' }, '1');
  const btnMenos = h('button', { type: 'button', 'aria-label': 'Diminuir quantidade', onclick: () => mudarQtd(-1) }, icone('menos'));
  const btnMais = h('button', { type: 'button', 'aria-label': 'Aumentar quantidade', onclick: () => mudarQtd(1) }, icone('mais'));
  const status = h('div', { 'aria-live': 'polite' });

  // Botao principal (ouro). No mobile ele fica oculto por CSS e a barra fixa assume a mesma acao.
  const btnComprar = h('button', { class: 'btn btn-ouro btn-bloco', type: 'button', onclick: comprar }, 'Comprar');
  const btnComprarMobile = h('button', { class: 'btn btn-ouro', type: 'button', onclick: comprar }, 'Comprar');
  const barraPreco = h('div', { class: 'barra-preco' });

  const maxQtd = () => Math.max(1, Math.min(estado.variacao.disponivel, 99));

  function mudarQtd(delta) {
    estado.quantidade = Math.min(maxQtd(), Math.max(1, estado.quantidade + delta));
    atualizarQuantidade();
  }

  function atualizarQuantidade() {
    qtdValor.textContent = String(estado.quantidade);
    btnMenos.disabled = estado.quantidade <= 1;
    btnMais.disabled = estado.quantidade >= maxQtd() || estado.variacao.disponivel <= 0;
  }

  function atualizarPreco() {
    const v = estado.variacao;
    const atual = precoEfetivo(v);
    const desconto = percentualDesconto(v.preco, atual);
    const parcelas = textoParcelamento(atual);
    montar(
      blocoPreco,
      h('div', { class: 'linha-preco' }, desconto ? h('span', { class: 'preco-de' }, moeda(v.preco)) : null, h('span', { class: 'preco-por' }, moeda(atual)), desconto ? h('span', { class: 'selo-desconto' }, `-${desconto}%`) : null),
      parcelas ? h('span', { class: 'parcelas' }, parcelas) : null,
    );
    seloGaleria.hidden = !desconto;
    seloGaleria.textContent = desconto ? `-${desconto}%` : '';
    montar(barraPreco, h('strong', {}, moeda(atual)), h('small', {}, parcelas || 'À vista no Pix ou cartão'));

    const livre = v.disponivel > 0;
    estoqueAviso.className = `estoque-aviso ${!livre ? 'baixo' : v.disponivel <= CONFIG.ESTOQUE_BAIXO ? 'baixo' : 'ok'}`;
    estoqueAviso.textContent = !livre
      ? 'Indisponível no momento'
      : v.disponivel <= CONFIG.ESTOQUE_BAIXO
        ? `Restam apenas ${v.disponivel} ${plural(v.disponivel, 'unidade', 'unidades')}`
        : 'Em estoque';
    for (const b of [btnComprar, btnComprarMobile]) {
      b.disabled = !livre;
      b.textContent = livre ? 'Comprar' : 'Indisponível';
    }
    estado.quantidade = Math.min(estado.quantidade, maxQtd());
    atualizarQuantidade();
  }

  function renderVariacoes() {
    if (variacoes.length <= 1) {
      grupoVariacao.hidden = true;
      return;
    }
    montar(
      grupoVariacao,
      h('span', { class: 'campo-rotulo' }, 'Opção', h('small', {}, rotuloVariacao(estado.variacao))),
      botoesVariacao,
    );
    montar(
      botoesVariacao,
      variacoes.map((v) =>
        h('li', {}, h('button', {
          class: 'chip', type: 'button', 'aria-pressed': v.id === estado.variacao.id ? 'true' : 'false', disabled: v.disponivel <= 0,
          title: v.disponivel <= 0 ? 'Indisponível' : null,
          onclick: () => {
            estado.variacao = v;
            estado.quantidade = 1;
            const idx = imagens.findIndex((im) => im.variacao_id && String(im.variacao_id) === String(v.id));
            if (idx >= 0) estado.imagem = idx;
            renderVariacoes();
            renderGaleria();
            atualizarPreco();
          },
        }, rotuloVariacao(v))),
      ),
    );
  }

  async function comprar(e) {
    const botao = e.currentTarget;
    montar(status);
    if (demo) {
      montar(status, h('p', { class: 'aviso' }, 'Este é um produto de demonstração e não pode ser comprado. Cadastre produtos no painel administrativo para vender.'));
      return;
    }
    const rotulo = botao.textContent;
    botao.disabled = true;
    await casca.pronta; // garante o token do cliente (carrinho vinculado a conta)
    botao.textContent = 'Adicionando...';
    try {
      await adicionarAoCarrinho(estado.variacao.id, estado.quantidade);
      toast(`${estado.quantidade} ${plural(estado.quantidade, 'item adicionado', 'itens adicionados')} à sacola.`);
      montar(status, h('p', { class: 'aviso aviso-sucesso' }, 'Adicionado à sacola. ', h('a', { class: 'link-sutil', href: 'sacola.html' }, 'Ver sacola e finalizar a compra')));
      await casca.atualizarContador();
    } catch (err) {
      montar(status, h('p', { class: 'aviso aviso-erro', role: 'alert' }, err.codigo === 'ESTOQUE_INSUFICIENTE' ? `Estoque insuficiente. Disponível: ${err.detalhes?.disponivel ?? 0}.` : err.message));
    } finally {
      botao.disabled = estado.variacao.disponivel <= 0;
      botao.textContent = rotulo;
    }
  }

  // ---------------------------------------------------------------- frete
  const frete = montarFrete();
  function montarFrete() {
    const entrada = h('input', { id: 'cep', inputmode: 'numeric', autocomplete: 'postal-code', placeholder: '00000-000', maxlength: '9', 'aria-label': 'CEP de entrega' });
    entrada.addEventListener('input', () => { entrada.value = formatarCep(entrada.value); });
    const resultado2 = h('div', { 'aria-live': 'polite' });
    const form = h(
      'form',
      {
        novalidate: true,
        onsubmit: async (ev) => {
          ev.preventDefault();
          const cep = entrada.value.replace(/\D/g, '');
          if (cep.length !== 8) {
            montar(resultado2, h('p', { class: 'aviso aviso-erro' }, 'Informe um CEP com 8 dígitos.'));
            return;
          }
          if (demo) {
            montar(resultado2, h('p', { class: 'aviso' }, 'O cálculo de frete não está disponível para produtos de demonstração.'));
            return;
          }
          montar(resultado2, h('p', { class: 'aviso' }, 'Calculando...'));
          try {
            const r = await cotarFrete(cep, [{ variacao_id: String(estado.variacao.id), quantidade: estado.quantidade }]);
            montar(
              resultado2,
              h('ul', { class: 'frete-opcoes' }, r.opcoes.map((o) =>
                h('li', {}, h('span', {}, o.nome, h('span', { class: 'prazo' }, `Entrega em até ${o.prazo_dias} ${plural(o.prazo_dias, 'dia', 'dias')} úteis`)), h('strong', {}, o.gratis || Number(o.valor) === 0 ? 'Grátis' : moeda(o.valor)))),
              ),
            );
          } catch (err) {
            montar(resultado2, h('p', { class: 'aviso aviso-erro', role: 'alert' }, err.message));
          }
        },
      },
      entrada,
      h('button', { class: 'btn btn-contorno btn-pequeno', type: 'submit' }, 'Calcular'),
    );
    return h('section', { class: 'frete', 'aria-labelledby': 'titulo-frete' }, h('span', { class: 'campo-rotulo', id: 'titulo-frete' }, 'Calcule o frete e o prazo'), form, resultado2);
  }

  // ---------------------------------------------------------------- montagem da pagina
  const categoria = produto.categorias?.[0];
  const migalhas = h(
    'nav',
    { class: 'migalhas', 'aria-label': 'Você está em' },
    h(
      'ol',
      {},
      h('li', {}, h('a', { href: './' }, 'Início')),
      categoria ? h('li', {}, h('a', { href: `index.html?categoria=${encodeURIComponent(categoria.slug)}` }, categoria.nome)) : null,
      h('li', { 'aria-current': 'page' }, produto.nome),
    ),
  );

  montar(
    principal,
    h(
      'div',
      { class: 'container' },
      migalhas,
      demo ? h('div', { class: 'aviso' }, 'Produto de demonstração (catálogo vazio).') : null,
      h(
        'article',
        { class: 'produto' },
        h('div', { class: 'galeria' }, principalImg, miniaturas),
        h(
          'div',
          { class: 'produto-info' },
          h('div', {}, produto.marca_nome ? h('a', { class: 'produto-marca', href: `index.html?marca=${encodeURIComponent(produto.marca_slug)}` }, produto.marca_nome) : null, h('h1', {}, produto.nome), produto.descricao_curta ? h('p', { class: 'produto-resumo' }, produto.descricao_curta) : null),
          blocoPreco,
          grupoVariacao,
          h('div', { class: 'campo-grupo' }, h('span', { class: 'campo-rotulo' }, 'Quantidade'), h('div', { class: 'quantidade' }, btnMenos, qtdValor, btnMais), estoqueAviso),
          h('div', { class: 'compra' }, btnComprar, faixaConfianca(produto.marca_nome), status),
          frete,
        ),
      ),
      produto.descricao
        ? h('section', { class: 'descricao-longa', 'aria-labelledby': 'titulo-descricao' }, h('h2', { id: 'titulo-descricao' }, 'Sobre o produto'), h('p', {}, produto.descricao))
        : null,
    ),
  );

  // Barra fixa do mobile: preco + comprar, com a confianca resumida numa linha.
  document.body.append(
    h('div', { class: 'barra-mobile', role: 'region', 'aria-label': 'Comprar' },
      h('div', { class: 'mini-confianca' }, `Pix · Parcele sem juros · ${textoOriginal(produto.marca_nome)}`),
      h('div', { class: 'linha' }, barraPreco, btnComprarMobile)),
  );
  document.body.classList.add('com-barra');

  renderVariacoes();
  renderGaleria();
  atualizarPreco();
  await Promise.all([casca.carregarCategorias(categoria?.slug), casca.carregarMarcas(produto.marca_slug)]);
}

iniciar();
