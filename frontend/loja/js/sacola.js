import { h, montar, toast } from './core/ui.js';
import { icone } from './core/icones.js';
import { obterCarrinho, alterarQuantidade, removerDoCarrinho, cotarFreteCarrinho, ApiError } from './core/api.js';
import { moeda, rotuloVariacao, formatarCep, plural } from './core/format.js';
import { logado, irParaIdentificacao, lerCheckout, salvarCheckout } from './core/sessao.js';
import { imagemProduto } from './componentes/card-produto.js';
import { passos } from './componentes/passos.js';
import { montarCasca } from './shell.js';

const casca = montarCasca();
const principal = document.getElementById('principal');

const estado = { carrinho: null, cupomErro: '', fretes: null, freteErro: '', freteCarregando: false, foco: null };

const MENSAGENS_PROBLEMA = {
  INDISPONIVEL: 'Produto indisponível',
  SEM_ESTOQUE: 'Sem estoque no momento',
  ESTOQUE_INSUFICIENTE: 'Quantidade acima do estoque',
};

// ------------------------------------------------------------------ dados
async function carregar() {
  const pref = lerCheckout();
  const c = await obterCarrinho(pref.cupom);
  estado.carrinho = c;
  estado.cupomErro = '';
  if (pref.cupom && c.cupom && !c.cupom.valido) {
    estado.cupomErro = c.cupom.motivo;
    salvarCheckout({ cupom: null });
  }
  const cep = pref.cep || c.cep_destino;
  if (cep && c.itens.length) await cotar(cep);
  else estado.fretes = null;
}

/** Cota o frete do carrinho (Melhor Envio, com cache no servidor) e mantem/seleciona uma opcao. */
async function cotar(cep) {
  estado.freteErro = '';
  estado.freteCarregando = true;
  try {
    const r = await cotarFreteCarrinho(cep, lerCheckout().cupom);
    estado.fretes = r.opcoes;
    const salvo = lerCheckout().frete;
    const escolhida = r.opcoes.find((o) => o.codigo === salvo?.codigo) || r.opcoes[0];
    salvarCheckout({ cep: r.cep, frete: { codigo: escolhida.codigo, nome: escolhida.nome, valor: escolhida.valor, prazo_dias: escolhida.prazo_dias } });
  } catch (e) {
    estado.fretes = null;
    estado.freteErro = e.message;
    salvarCheckout({ frete: null });
  } finally {
    estado.freteCarregando = false;
  }
}

async function recarregar(foco) {
  estado.foco = foco || null;
  try {
    await carregar();
  } catch (e) {
    toast(e.message, 'erro');
  }
  render();
}

// ------------------------------------------------------------------ acoes
async function mudarQuantidade(item, nova) {
  try {
    await alterarQuantidade(item.variacao_id, nova);
  } catch (e) {
    toast(e instanceof ApiError && e.codigo === 'ESTOQUE_INSUFICIENTE' ? `Estoque insuficiente. Disponível: ${e.detalhes?.disponivel ?? 0}.` : e.message, 'erro');
  }
  await recarregar(`[data-var="${item.variacao_id}"][data-acao="${nova > item.quantidade ? 'mais' : 'menos'}"]`);
  casca.atualizarContador();
}

async function remover(item) {
  try {
    await removerDoCarrinho(item.variacao_id);
    toast('Item removido da sacola.');
  } catch (e) {
    toast(e.message, 'erro');
  }
  await recarregar();
  casca.atualizarContador();
}

async function aplicarCupom(codigo) {
  const cod = codigo.trim();
  if (!cod) return;
  salvarCheckout({ cupom: cod.toUpperCase() });
  await recarregar();
  if (!estado.cupomErro) toast('Cupom aplicado.');
}

async function removerCupom() {
  salvarCheckout({ cupom: null });
  await recarregar();
}

async function calcularFrete(cepTexto) {
  const cep = cepTexto.replace(/\D/g, '');
  if (cep.length !== 8) {
    estado.freteErro = 'Informe um CEP com 8 dígitos.';
    render();
    return;
  }
  estado.freteCarregando = true;
  render();
  await cotar(cep);
  render();
}

function escolherFrete(opcao) {
  salvarCheckout({ frete: { codigo: opcao.codigo, nome: opcao.nome, valor: opcao.valor, prazo_dias: opcao.prazo_dias } });
  render();
}

async function finalizar() {
  await casca.pronta;
  if (logado()) window.location.assign('checkout.html');
  else irParaIdentificacao('checkout.html');
}

// ------------------------------------------------------------------ render
function linhaItem(item) {
  const problema = item.problema ? MENSAGENS_PROBLEMA[item.problema] : '';
  const max = Math.max(item.disponivel, 0);
  const url = `produto.html?slug=${encodeURIComponent(item.slug)}`;
  return h(
    'li',
    { class: 'item-sacola' },
    h('a', { class: 'item-imagem', href: url, 'aria-label': item.nome }, imagemProduto(item.imagem, item.nome)),
    h(
      'div',
      { class: 'item-info' },
      h('a', { class: 'item-nome', href: url }, item.nome),
      item.atributos ? h('span', { class: 'item-variacao' }, rotuloVariacao(item)) : null,
      h('span', { class: 'item-unitario' }, `${moeda(item.preco_unitario)} cada`),
      problema ? h('span', { class: 'item-problema', role: 'alert' }, item.problema === 'ESTOQUE_INSUFICIENTE' ? `${problema} (disponível: ${max})` : problema) : null,
      h(
        'div',
        { class: 'item-acoes' },
        h(
          'div',
          { class: 'quantidade' },
          h('button', { type: 'button', 'aria-label': `Diminuir quantidade de ${item.nome}`, 'data-var': item.variacao_id, 'data-acao': 'menos', disabled: item.quantidade <= 1, onclick: () => mudarQuantidade(item, item.quantidade - 1) }, icone('menos')),
          h('output', { 'aria-live': 'polite' }, String(item.quantidade)),
          h('button', { type: 'button', 'aria-label': `Aumentar quantidade de ${item.nome}`, 'data-var': item.variacao_id, 'data-acao': 'mais', disabled: item.quantidade >= Math.min(max, 99), onclick: () => mudarQuantidade(item, item.quantidade + 1) }, icone('mais')),
        ),
        h('button', { class: 'btn-texto', type: 'button', onclick: () => remover(item) }, 'Remover'),
      ),
    ),
    h('div', { class: 'item-total' }, moeda(item.total)),
  );
}

function painelCupom(c) {
  const pref = lerCheckout();
  const aplicado = c.cupom?.valido ? c.cupom : null;
  const campo = h('input', { id: 'cupom', type: 'text', autocomplete: 'off', placeholder: 'Código do cupom', maxlength: '40', 'aria-label': 'Código do cupom', value: aplicado ? '' : pref.cupom || '', 'aria-invalid': estado.cupomErro ? 'true' : null });
  return h(
    'div',
    { class: 'campo' },
    h('label', { for: 'cupom' }, 'Cupom de desconto'),
    aplicado
      ? h('div', { class: 'linha-valor' }, h('span', {}, `Cupom ${aplicado.codigo} aplicado`), h('button', { class: 'btn-texto', type: 'button', onclick: removerCupom }, 'Remover'))
      : h(
          'form',
          { class: 'linha-form', onsubmit: (e) => { e.preventDefault(); aplicarCupom(campo.value); } },
          h('div', { class: 'campo' }, campo),
          h('button', { class: 'btn btn-contorno btn-pequeno', type: 'submit' }, 'Aplicar'),
        ),
    estado.cupomErro ? h('span', { class: 'erro-campo', role: 'alert' }, estado.cupomErro) : null,
  );
}

function painelFrete() {
  const pref = lerCheckout();
  const cep = h('input', { id: 'cep', inputmode: 'numeric', autocomplete: 'postal-code', placeholder: '00000-000', maxlength: '9', 'aria-label': 'CEP de entrega', value: formatarCep(pref.cep || estado.carrinho.cep_destino || '') });
  cep.addEventListener('input', () => { cep.value = formatarCep(cep.value); });
  const escolhido = pref.frete?.codigo;
  return h(
    'div',
    { class: 'campo' },
    h('label', { for: 'cep' }, 'Calcular frete e prazo'),
    h(
      'form',
      { class: 'linha-form', onsubmit: (e) => { e.preventDefault(); calcularFrete(cep.value); } },
      h('div', { class: 'campo' }, cep),
      h('button', { class: 'btn btn-contorno btn-pequeno', type: 'submit', disabled: estado.freteCarregando }, estado.freteCarregando ? 'Calculando...' : 'Calcular'),
    ),
    h(
      'div',
      { id: 'area-frete-resultado', 'aria-live': 'polite' },
      estado.freteErro ? h('span', { class: 'erro-campo', role: 'alert' }, estado.freteErro) : null,
      estado.fretes
        ? h(
            'ul',
            { class: 'opcoes', role: 'radiogroup', 'aria-label': 'Opções de entrega' },
            estado.fretes.map((o) =>
              h(
                'li',
                {},
                h(
                  'label',
                  { class: 'opcao' },
                  h('input', { type: 'radio', name: 'frete', value: o.codigo, checked: o.codigo === escolhido, onchange: () => escolherFrete(o) }),
                  h('span', {}, h('strong', {}, o.nome), h('span', { class: 'sub' }, `Entrega em até ${o.prazo_dias} ${plural(o.prazo_dias, 'dia útil', 'dias úteis')}`)),
                  h('strong', { class: o.gratis || Number(o.valor) === 0 ? 'gratis' : '' }, o.gratis || Number(o.valor) === 0 ? 'Grátis' : moeda(o.valor)),
                ),
              ),
            ),
          )
        : null,
    ),
  );
}

function resumo(c) {
  const pref = lerCheckout();
  const frete = estado.fretes && pref.frete ? Number(pref.frete.valor) : null;
  const total = Number(c.total_produtos) + (frete ?? 0);
  const bloqueado = c.tem_problemas;
  const botaoFinalizar = h('button', { class: 'btn btn-ouro btn-bloco', type: 'button', disabled: bloqueado, onclick: finalizar }, 'Finalizar compra');
  return {
    total,
    bloqueado,
    el: h(
      'aside',
      { class: 'resumo', 'aria-label': 'Resumo do pedido' },
      h(
        'div',
        { class: 'painel' },
        h('div', { class: 'painel-cabecalho' }, h('h2', {}, 'Resumo do pedido')),
        h(
          'div',
          { class: 'painel-corpo' },
          painelCupom(c),
          painelFrete(),
          h(
            'div',
            { class: 'stack-valores' },
            h('div', { class: 'linha-valor' }, h('span', { class: 'muted' }, `Subtotal (${c.quantidade_itens} ${plural(c.quantidade_itens, 'item', 'itens')})`), h('strong', {}, moeda(c.subtotal))),
            Number(c.desconto) > 0 ? h('div', { class: 'linha-valor desconto' }, h('span', { class: 'muted' }, 'Desconto'), h('strong', {}, `- ${moeda(c.desconto)}`)) : null,
            h('div', { class: 'linha-valor' }, h('span', { class: 'muted' }, 'Frete'), frete === null ? h('span', { class: 'muted' }, 'Calcule acima') : frete === 0 ? h('strong', { class: 'gratis' }, 'Grátis') : h('strong', {}, moeda(frete))),
          ),
          h('div', { class: 'linha-valor total' }, h('span', {}, 'Total'), h('strong', {}, moeda(total))),
          bloqueado ? h('p', { class: 'aviso aviso-erro', role: 'alert' }, 'Revise os itens indisponíveis para continuar.') : null,
          botaoFinalizar,
          h('p', { class: 'muted' }, 'Pague com Pix, cartão em até 12x sem juros ou boleto.'),
          h('a', { class: 'link-sutil', href: 'index.html?todos=1' }, 'Continuar comprando'),
        ),
      ),
    ),
  };
}

function render() {
  const c = estado.carrinho;
  document.body.querySelector('.barra-fluxo')?.remove();
  document.body.classList.remove('com-barra-fluxo');

  if (!c || c.itens.length === 0) {
    montar(
      principal,
      h(
        'div',
        { class: 'container' },
        h('div', { class: 'fluxo-topo' }, h('h1', {}, 'Sua sacola')),
        h(
          'div',
          { class: 'vazio' },
          h('strong', {}, 'Sua sacola está vazia'),
          h('p', {}, 'Escolha seus produtos favoritos e volte aqui para finalizar a compra.'),
          h('p', {}, h('a', { class: 'btn btn-ouro', href: 'index.html?todos=1' }, 'Explorar produtos')),
        ),
      ),
    );
    return;
  }

  const r = resumo(c);
  montar(
    principal,
    h(
      'div',
      { class: 'container' },
      h('div', { class: 'fluxo-topo' }, h('h1', {}, 'Sua sacola'), passos(1)),
      h(
        'div',
        { class: 'fluxo' },
        h('div', { class: 'fluxo-principal' }, h('section', { class: 'painel', 'aria-label': 'Itens da sacola' }, h('ul', { class: 'itens-sacola' }, c.itens.map(linhaItem)))),
        r.el,
      ),
    ),
  );

  // Barra fixa do mobile (a acao principal vive aqui; o botao do resumo fica oculto por CSS).
  document.body.append(
    h('div', { class: 'barra-fluxo', role: 'region', 'aria-label': 'Total e finalizar' },
      h('div', {}, h('small', {}, 'Total'), h('strong', {}, moeda(r.total))),
      h('button', { class: 'btn btn-ouro', type: 'button', disabled: r.bloqueado, onclick: finalizar }, 'Finalizar compra')),
  );
  document.body.classList.add('com-barra-fluxo');

  if (estado.foco) {
    document.querySelector(estado.foco)?.focus();
    estado.foco = null;
  }
}

async function iniciar() {
  document.title = 'Sacola | Savordelli';
  montar(principal, h('div', { class: 'container' }, h('div', { class: 'fluxo-topo' }, h('h1', {}, 'Sua sacola')), h('div', { class: 'skeleton', 'aria-hidden': 'true' })));
  await casca.pronta;
  try {
    await carregar();
  } catch (e) {
    montar(principal, h('div', { class: 'container secao' }, h('div', { class: 'vazio' }, h('strong', {}, 'Não foi possível carregar a sacola'), h('p', {}, e.message), h('p', {}, h('button', { class: 'btn btn-contorno btn-pequeno', type: 'button', onclick: iniciar }, 'Tentar novamente')))));
    return;
  }
  render();
  await Promise.all([casca.carregarCategorias(), casca.carregarMarcas()]);
}

iniciar();
