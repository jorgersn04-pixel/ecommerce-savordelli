import { h, montar, toast } from './core/ui.js';
import { icone } from './core/icones.js';
import {
  obterCarrinho, listarEnderecos, criarEndereco, cotarFreteCarrinho, criarPedido, pagarPedido,
  situacaoPagamento, cancelarPedido, configPagamento, simularAprovacao, ApiError,
} from './core/api.js';
import { moeda, formatarCep, plural } from './core/format.js';
import { logado, usuarioAtual, irParaIdentificacao, lerCheckout, salvarCheckout, limparCheckout } from './core/sessao.js';
import { imagemProduto } from './componentes/card-produto.js';
import { passos } from './componentes/passos.js';
import { criarFormularioCartao } from './pagamento/cartao.js';
import { montarCasca } from './shell.js';

const casca = montarCasca();
const principal = document.getElementById('principal');

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const ERROS_DA_SACOLA = ['ESTOQUE_INSUFICIENTE', 'ITENS_INDISPONIVEIS', 'PRECO_ALTERADO', 'CUPOM_ALTERADO', 'CUPOM_INVALIDO', 'CARRINHO_VAZIO', 'CARRINHO_JA_PROCESSADO'];

const estado = {
  tela: 'form', // form | pix | boleto | analise | sucesso | cancelado
  carrinho: null, enderecos: [], enderecoId: null, formEndereco: false,
  fretes: null, freteErro: '', freteCarregando: false, freteSel: null,
  metodo: 'pix', config: { modo: 'simulado', public_key: null }, cartao: null,
  pedido: null, pagamento: null, enviando: false, erro: '', erroSacola: false,
};
let timerPolling = null;

// ------------------------------------------------------------------ dados
const total = () => Number(estado.carrinho.total_produtos) + (estado.freteSel ? Number(estado.freteSel.valor) : 0);
const enderecoAtual = () => estado.enderecos.find((e) => String(e.id) === String(estado.enderecoId));
const pronto = () => Boolean(estado.enderecoId && estado.freteSel && !estado.carrinho.tem_problemas);

async function cotar() {
  const end = enderecoAtual();
  estado.freteErro = '';
  estado.fretes = null;
  if (!end) return;
  estado.freteCarregando = true;
  renderFrete();
  try {
    const r = await cotarFreteCarrinho(end.cep, lerCheckout().cupom);
    estado.fretes = r.opcoes;
    const salvo = lerCheckout().frete;
    estado.freteSel = r.opcoes.find((o) => o.codigo === salvo?.codigo) || r.opcoes[0];
    salvarCheckout({ cep: r.cep, frete: { codigo: estado.freteSel.codigo, nome: estado.freteSel.nome, valor: estado.freteSel.valor, prazo_dias: estado.freteSel.prazo_dias } });
  } catch (e) {
    estado.freteErro = e.message;
    estado.freteSel = null;
  } finally {
    estado.freteCarregando = false;
  }
  renderFrete();
  renderResumo();
}

// ------------------------------------------------------------------ areas fixas (nao recriadas a cada mudanca)
const areaErro = h('div', { 'aria-live': 'assertive' });
const areaEndereco = h('section', { class: 'painel', 'aria-labelledby': 't-entrega' });
const areaFrete = h('section', { class: 'painel', 'aria-labelledby': 't-frete' });
const areaPagamento = h('section', { class: 'painel', 'aria-labelledby': 't-pagamento' });
const areaResumo = h('div', {});
const corpoPix = h('div', { class: 'painel-corpo' });
const corpoCartao = h('div', { class: 'painel-corpo' });
const corpoBoleto = h('div', { class: 'painel-corpo' });
const abasEl = h('div', { class: 'abas', role: 'tablist', 'aria-label': 'Forma de pagamento' });

const tituloPainel = (n, id, texto) => h('div', { class: 'painel-cabecalho' }, h('h2', { id, class: 'passo-titulo' }, h('span', { class: 'passo-numero' }, String(n)), texto));

// ------------------------------------------------------------------ entrega
function formularioEndereco() {
  const campos = {};
  const f = (nome, rotulo, props = {}) => {
    const id = `end-${nome}`;
    const input = props.select
      ? h('select', { id, name: nome }, UFS.map((u) => h('option', { value: u, selected: u === 'SP' }, u)))
      : h('input', { id, name: nome, autocomplete: props.autocomplete, inputmode: props.inputmode, maxlength: props.maxlength, value: props.valor ?? '' });
    if (nome === 'cep') input.addEventListener('input', () => { input.value = formatarCep(input.value); });
    const erro = h('span', { class: 'erro-campo', role: 'alert' });
    campos[nome] = { input, erro };
    return h('div', { class: `campo ${props.cheio ? 'cheio' : ''}`.trim() }, h('label', { for: id }, rotulo, props.opcional ? h('span', { class: 'dica' }, ' (opcional)') : null), input, erro);
  };
  const nomePerfil = usuarioAtual()?.nome || '';
  const form = h(
    'form',
    { class: 'endereco-novo', novalidate: true, 'aria-label': 'Novo endereço' },
    h('div', { class: 'grade-campos' },
      f('destinatario', 'Nome de quem vai receber', { cheio: true, autocomplete: 'name', valor: nomePerfil }),
      f('cep', 'CEP', { inputmode: 'numeric', autocomplete: 'postal-code', maxlength: '9' }),
      f('uf', 'Estado', { select: true }),
      f('logradouro', 'Endereço', { cheio: true, autocomplete: 'address-line1' }),
      f('numero', 'Número', { autocomplete: 'off' }),
      f('complemento', 'Complemento', { opcional: true }),
      f('bairro', 'Bairro'),
      f('cidade', 'Cidade', { autocomplete: 'address-level2' })),
    h('div', { class: 'acoes-linha' },
      h('button', { class: 'btn btn-contorno btn-pequeno', type: 'submit' }, 'Salvar endereço'),
      estado.enderecos.length ? h('button', { class: 'btn-texto', type: 'button', onclick: () => { estado.formEndereco = false; renderEndereco(); } }, 'Cancelar') : null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, c.input.value.trim()]));
    const obrigatorios = { destinatario: 'Informe o nome.', logradouro: 'Informe o endereço.', numero: 'Informe o número.', bairro: 'Informe o bairro.', cidade: 'Informe a cidade.' };
    let ok = true;
    for (const [k, msg] of Object.entries(obrigatorios)) { campos[k].erro.textContent = v[k] ? '' : msg; if (!v[k]) ok = false; }
    if (v.cep.replace(/\D/g, '').length !== 8) { campos.cep.erro.textContent = 'CEP com 8 dígitos.'; ok = false; } else campos.cep.erro.textContent = '';
    if (!ok) return;
    const botao = form.querySelector('button[type=submit]');
    botao.disabled = true;
    try {
      const novo = await criarEndereco({ destinatario: v.destinatario, cep: v.cep, logradouro: v.logradouro, numero: v.numero, complemento: v.complemento || undefined, bairro: v.bairro, cidade: v.cidade, uf: v.uf, padrao: estado.enderecos.length === 0 });
      estado.enderecos = [...estado.enderecos, novo];
      estado.enderecoId = String(novo.id);
      estado.formEndereco = false;
      salvarCheckout({ enderecoId: estado.enderecoId });
      renderEndereco();
      await cotar();
    } catch (err) {
      botao.disabled = false;
      for (const d of err.detalhes || []) if (campos[d.path?.[0]]) campos[d.path[0]].erro.textContent = d.message;
      toast(err.message, 'erro');
    }
  });
  return form;
}

function renderEndereco() {
  const lista = estado.enderecos.length && !estado.formEndereco
    ? h('ul', { class: 'opcoes', role: 'radiogroup', 'aria-label': 'Endereços salvos' }, estado.enderecos.map((e) =>
        h('li', {}, h('label', { class: 'opcao' },
          h('input', { type: 'radio', name: 'endereco', value: e.id, checked: String(e.id) === String(estado.enderecoId), onchange: async () => { estado.enderecoId = String(e.id); salvarCheckout({ enderecoId: estado.enderecoId }); estado.freteSel = null; renderResumo(); await cotar(); } }),
          h('span', {}, h('strong', {}, e.destinatario), h('span', { class: 'sub' }, `${e.logradouro}, ${e.numero}${e.complemento ? ` - ${e.complemento}` : ''}`), h('span', { class: 'sub' }, `${e.bairro} - ${e.cidade}/${e.uf} - CEP ${formatarCep(e.cep)}`)),
          h('span', {}, e.padrao ? h('span', { class: 'etiqueta' }, 'Padrão') : null)))))
    : null;
  montar(areaEndereco, tituloPainel(1, 't-entrega', 'Endereço de entrega'), h('div', { class: 'painel-corpo' }, lista,
    estado.formEndereco || !estado.enderecos.length ? formularioEndereco() : h('div', {}, h('button', { class: 'btn btn-contorno btn-pequeno', type: 'button', onclick: () => { estado.formEndereco = true; renderEndereco(); } }, 'Usar outro endereço'))));
}

function renderFrete() {
  const corpo = [];
  if (!enderecoAtual()) corpo.push(h('p', { class: 'muted-texto' }, 'Escolha ou cadastre um endereço para ver as opções de entrega.'));
  else if (estado.freteCarregando) corpo.push(h('p', { class: 'aviso' }, 'Calculando frete...'));
  else if (estado.freteErro) corpo.push(h('p', { class: 'aviso aviso-erro', role: 'alert' }, estado.freteErro), h('button', { class: 'btn btn-contorno btn-pequeno', type: 'button', onclick: cotar }, 'Tentar novamente'));
  else if (estado.fretes) {
    corpo.push(h('ul', { class: 'opcoes', role: 'radiogroup', 'aria-label': 'Opções de entrega' }, estado.fretes.map((o) =>
      h('li', {}, h('label', { class: 'opcao' },
        h('input', { type: 'radio', name: 'frete', value: o.codigo, checked: estado.freteSel?.codigo === o.codigo, onchange: () => { estado.freteSel = o; salvarCheckout({ frete: { codigo: o.codigo, nome: o.nome, valor: o.valor, prazo_dias: o.prazo_dias } }); renderResumo(); } }),
        h('span', {}, h('strong', {}, o.nome), h('span', { class: 'sub' }, `Entrega em até ${o.prazo_dias} ${plural(o.prazo_dias, 'dia útil', 'dias úteis')}`)),
        h('strong', { class: o.gratis || Number(o.valor) === 0 ? 'gratis' : '' }, o.gratis || Number(o.valor) === 0 ? 'Grátis' : moeda(o.valor)))))));
  }
  montar(areaFrete, tituloPainel(2, 't-frete', 'Forma de entrega'), h('div', { class: 'painel-corpo' }, corpo));
}

// ------------------------------------------------------------------ pagamento
function renderAbas() {
  const aba = (id, rotulo, ic) => h('button', { class: 'aba', type: 'button', role: 'tab', 'aria-selected': estado.metodo === id ? 'true' : 'false', onclick: () => { estado.metodo = id; estado.erro = ''; renderAbas(); renderErro(); if (id === 'cartao') garantirCartao(); renderResumo(); } }, icone(ic), rotulo);
  montar(abasEl, aba('pix', 'Pix', 'pix'), aba('cartao', 'Cartão', 'cartao'), aba('boleto', 'Boleto', 'original'));
  corpoPix.hidden = estado.metodo !== 'pix';
  corpoCartao.hidden = estado.metodo !== 'cartao';
  corpoBoleto.hidden = estado.metodo !== 'boleto';
}

async function garantirCartao() {
  if (estado.cartao) return;
  montar(corpoCartao, h('p', { class: 'aviso' }, 'Carregando formulário do cartão...'));
  try {
    estado.cartao = await criarFormularioCartao({ config: estado.config, total: total() });
    montar(corpoCartao, estado.cartao.el);
  } catch (e) {
    montar(corpoCartao, h('p', { class: 'aviso aviso-erro', role: 'alert' }, e.message));
  }
}

function renderErro() {
  montar(areaErro, estado.erro ? h('div', { class: 'aviso aviso-erro', role: 'alert' }, estado.erro, estado.erroSacola ? [' ', h('a', { class: 'link-sutil', href: 'sacola.html' }, 'Voltar à sacola')] : null) : null);
}

function renderPagamentoBase() {
  montar(corpoPix, h('p', {}, 'Pague pelo app do seu banco com o QR Code ou o código Pix. A aprovação é imediata e o código vale por 30 minutos.'));
  montar(corpoBoleto, h('p', {}, 'Geramos o boleto ao finalizar o pedido. O vencimento é em 3 dias e a confirmação do pagamento pode levar até 2 dias úteis. Se não for pago no prazo, o pedido é cancelado.'));
  montar(areaPagamento, tituloPainel(3, 't-pagamento', 'Pagamento'), h('div', { class: 'painel-corpo' }, abasEl), corpoPix, corpoCartao, corpoBoleto);
  renderAbas();
  if (estado.metodo === 'cartao') garantirCartao();
}

// ------------------------------------------------------------------ resumo e envio
function rotuloBotao() {
  if (estado.enviando) return 'Processando...';
  if (estado.pedido) return 'Tentar novamente';
  return 'Finalizar pedido';
}

function renderResumo() {
  const c = estado.carrinho;
  const frete = estado.freteSel ? Number(estado.freteSel.valor) : null;
  const botaoMobile = h('button', { class: 'btn btn-ouro', type: 'button', disabled: !pronto() || estado.enviando, onclick: finalizar }, rotuloBotao());
  const el = h('aside', { class: 'resumo', 'aria-label': 'Resumo do pedido' },
    h('div', { class: 'painel' },
      h('div', { class: 'painel-cabecalho' }, h('h2', {}, 'Resumo do pedido')),
      h('div', { class: 'painel-corpo' },
        h('ul', { class: 'itens-resumo plain-lista' }, c.itens.map((i) =>
          h('li', { class: 'resumo-item' }, h('span', { class: 'mini' }, imagemProduto(i.imagem, i.nome)), h('span', {}, i.nome, h('small', {}, `${i.quantidade} ${plural(i.quantidade, 'unidade', 'unidades')}`)), h('strong', {}, moeda(i.total))))),
        h('div', { class: 'stack-valores' },
          h('div', { class: 'linha-valor' }, h('span', { class: 'muted' }, 'Subtotal'), h('strong', {}, moeda(c.subtotal))),
          Number(c.desconto) > 0 ? h('div', { class: 'linha-valor desconto' }, h('span', { class: 'muted' }, c.cupom?.codigo ? `Cupom ${c.cupom.codigo}` : 'Desconto'), h('strong', {}, `- ${moeda(c.desconto)}`)) : null,
          h('div', { class: 'linha-valor' }, h('span', { class: 'muted' }, `Frete${estado.freteSel ? ` (${estado.freteSel.nome})` : ''}`), frete === null ? h('span', { class: 'muted' }, 'A definir') : frete === 0 ? h('strong', { class: 'gratis' }, 'Grátis') : h('strong', {}, moeda(frete)))),
        h('div', { class: 'linha-valor total' }, h('span', {}, 'Total'), h('strong', {}, moeda(total()))),
        // Unica acao principal (ouro) da tela; no mobile ela vive na barra fixa.
        h('button', { class: 'btn btn-ouro btn-bloco', type: 'button', disabled: !pronto() || estado.enviando, onclick: finalizar }, rotuloBotao()),
        h('p', { class: 'muted-texto' }, 'Ambiente seguro. Seus dados de pagamento não ficam armazenados na loja.'),
        h('a', { class: 'link-sutil', href: 'sacola.html' }, 'Voltar à sacola'))));
  montar(areaResumo, el);
  document.body.querySelector('.barra-fluxo')?.remove();
  if (estado.tela === 'form') {
    document.body.append(h('div', { class: 'barra-fluxo', role: 'region', 'aria-label': 'Total e finalizar' }, h('div', {}, h('small', {}, 'Total'), h('strong', {}, moeda(total()))), botaoMobile));
    document.body.classList.add('com-barra-fluxo');
  } else {
    document.body.classList.remove('com-barra-fluxo');
  }
}

function mensagemDe(e) {
  if (e instanceof ApiError && e.codigo === 'ESTOQUE_INSUFICIENTE') return 'Um dos itens ficou sem estoque suficiente. Revise a sacola.';
  if (e instanceof ApiError && e.codigo === 'PRECO_ALTERADO') return 'Os preços foram atualizados. Revise a sacola antes de continuar.';
  return e.message;
}

async function finalizar() {
  if (estado.enviando || !pronto()) return;
  estado.erro = '';
  estado.erroSacola = false;
  renderErro();

  let pagamento;
  try {
    if (estado.metodo === 'cartao') {
      await garantirCartao();
      if (!estado.cartao?.validar()) { estado.erro = 'Confira os dados do cartão.'; renderErro(); return; }
      const d = await estado.cartao.obterDados();
      pagamento = { metodo: 'cartao_credito', token: d.token, payment_method_id: d.payment_method_id, parcelas: d.parcelas, ...(d.issuer_id ? { issuer_id: d.issuer_id } : {}) };
    } else {
      pagamento = { metodo: estado.metodo };
    }
  } catch (e) {
    estado.erro = e.message;
    renderErro();
    return;
  }

  estado.enviando = true;
  renderResumo();
  try {
    const r = estado.pedido
      ? await pagarPedido(estado.pedido.numero, pagamento)
      : await criarPedido({ endereco_id: estado.enderecoId, frete_servico: estado.freteSel.codigo, ...(lerCheckout().cupom ? { cupom: lerCheckout().cupom } : {}), pagamento });
    estado.pedido = r.pedido;
    estado.pagamento = r.pagamento;
    casca.atualizarContador(); // a sacola foi convertida em pedido
    tratarResultado();
  } catch (e) {
    if (e.detalhes?.pedido && !estado.pedido) estado.pedido = { numero: e.detalhes.pedido };
    estado.erro = mensagemDe(e);
    estado.erroSacola = e instanceof ApiError && ERROS_DA_SACOLA.includes(e.codigo);
    renderErro();
  } finally {
    estado.enviando = false;
    if (estado.tela === 'form') renderResumo();
  }
}

function tratarResultado() {
  const { pedido, pagamento } = estado;
  estado.cartao?.limparSensiveis?.();
  if (pedido.status === 'pago' || pagamento.status === 'aprovado') return sucesso();
  if (pagamento.status === 'recusado') {
    estado.erro = pagamento.mensagem || 'Pagamento recusado. Tente outro cartão ou outra forma de pagamento.';
    estado.cartao = null; // novo formulario limpo
    if (estado.metodo === 'cartao') garantirCartao();
    renderErro();
    return;
  }
  // pendente: pix e boleto aguardam; cartao em analise
  estado.tela = estado.metodo === 'pix' ? 'pix' : estado.metodo === 'boleto' ? 'boleto' : 'analise';
  render();
  iniciarPolling();
}

// ------------------------------------------------------------------ acompanhamento
function pararPolling() {
  if (timerPolling) clearInterval(timerPolling);
  timerPolling = null;
}

function iniciarPolling() {
  pararPolling();
  const limite = Date.now() + 35 * 60_000;
  const checar = async () => {
    if (!estado.pedido || Date.now() > limite) return pararPolling();
    try {
      const s = await situacaoPagamento(estado.pedido.numero);
      if (s.status_pedido === 'pago') { pararPolling(); sucesso(); }
      else if (s.status_pedido === 'cancelado') { pararPolling(); estado.tela = 'cancelado'; render(); }
    } catch {
      // falha momentanea: tenta de novo no proximo ciclo
    }
  };
  timerPolling = setInterval(checar, 4000);
}

function sucesso() {
  pararPolling();
  estado.tela = 'sucesso';
  limparCheckout();
  casca.atualizarContador();
  render();
}

async function copiar(texto, mensagem) {
  try {
    await navigator.clipboard.writeText(texto);
    toast(mensagem);
  } catch {
    toast('Não foi possível copiar. Selecione o código e copie manualmente.', 'erro');
  }
}

async function cancelar() {
  if (!window.confirm('Cancelar este pedido? Os itens voltam ao estoque.')) return;
  try {
    await cancelarPedido(estado.pedido.numero);
    pararPolling();
    estado.tela = 'cancelado';
    render();
  } catch (e) {
    toast(e.message, 'erro');
  }
}

// ------------------------------------------------------------------ telas de resultado
const notaSimulacao = () =>
  estado.config.modo === 'simulado'
    ? h('div', { class: 'nota-teste' }, 'Ambiente de teste: o Mercado Pago não está conectado. ', h('button', { class: 'btn btn-contorno btn-pequeno', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { await simularAprovacao(estado.pedido.numero); toast('Pagamento simulado aprovado.'); } catch (err) { toast(err.message, 'erro'); e.currentTarget.disabled = false; } } }, 'Simular pagamento aprovado'))
    : null;

function telaPix() {
  const pix = estado.pagamento.pix;
  const real = estado.config.modo === 'real' && pix?.qr_code_base64;
  const validade = estado.pagamento.expira_em ? new Date(estado.pagamento.expira_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
  return h('section', { class: 'painel', 'aria-labelledby': 't-pix' },
    h('div', { class: 'painel-cabecalho' }, h('h2', { id: 't-pix' }, 'Pague com Pix')),
    h('div', { class: 'painel-corpo' }, h('div', { class: 'caixa-pix' },
      real ? h('img', { class: 'qr', src: `data:image/png;base64,${pix.qr_code_base64}`, alt: 'QR Code do Pix' }) : h('div', { class: 'pix-qr-simulado' }, 'QR Code do Pix (ambiente de teste)'),
      h('div', {}, h('strong', {}, `Total ${moeda(estado.pedido.total)}`), validade ? h('div', { class: 'muted-texto' }, `Válido até ${validade}`) : null),
      h('div', { class: 'campo', 'aria-label': 'Código Pix copia e cola' }, h('label', {}, 'Pix copia e cola'), h('div', { class: 'codigo-copia' }, pix?.qr_code || '')),
      h('div', { class: 'acoes-linha' }, h('button', { class: 'btn btn-contorno', type: 'button', onclick: () => copiar(pix?.qr_code || '', 'Código Pix copiado.') }, 'Copiar código Pix')),
      h('span', { class: 'status-espera', role: 'status' }, h('span', { class: 'pulso' }), 'Aguardando a confirmação do pagamento...'),
      notaSimulacao(),
      h('button', { class: 'btn-texto', type: 'button', onclick: cancelar }, 'Cancelar pedido'))));
}

function telaBoleto() {
  const b = estado.pagamento.boleto;
  return h('section', { class: 'painel', 'aria-labelledby': 't-boleto' },
    h('div', { class: 'painel-cabecalho' }, h('h2', { id: 't-boleto' }, 'Boleto gerado')),
    h('div', { class: 'painel-corpo' }, h('div', { class: 'caixa-pix' },
      h('strong', {}, `Total ${moeda(estado.pedido.total)}`),
      h('p', { class: 'muted-texto' }, 'Pague em qualquer banco, app ou lotérica. Vencimento em 3 dias; a confirmação pode levar até 2 dias úteis.'),
      b?.codigo_barras ? h('div', { class: 'campo' }, h('label', {}, 'Código de barras'), h('div', { class: 'codigo-copia' }, b.codigo_barras)) : null,
      h('div', { class: 'acoes-linha' },
        b?.url ? h('a', { class: 'btn btn-contorno', href: b.url, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir boleto') : null,
        b?.codigo_barras ? h('button', { class: 'btn btn-contorno', type: 'button', onclick: () => copiar(b.codigo_barras, 'Código de barras copiado.') }, 'Copiar código de barras') : null),
      h('span', { class: 'status-espera', role: 'status' }, h('span', { class: 'pulso' }), 'Aguardando a confirmação do pagamento...'),
      notaSimulacao(),
      h('button', { class: 'btn-texto', type: 'button', onclick: cancelar }, 'Cancelar pedido'))));
}

function telaSimples(titulo, texto, extra) {
  return h('section', { class: 'painel' }, h('div', { class: 'sucesso-pedido' }, extra, h('h2', {}, titulo), h('p', { class: 'muted-texto' }, texto)));
}

function telaSucesso() {
  return h('section', { class: 'painel', 'aria-labelledby': 't-ok' },
    h('div', { class: 'sucesso-pedido' },
      h('span', { class: 'selo-ok' }, icone('check')),
      h('h2', { id: 't-ok' }, 'Pedido confirmado'),
      h('span', { class: 'numero-pedido' }, estado.pedido.numero),
      h('p', { class: 'muted-texto' }, `Pagamento aprovado: ${moeda(estado.pedido.total)}. Guarde o número do pedido para acompanhamento e atendimento.`),
      h('a', { class: 'btn btn-ouro', href: 'index.html?todos=1' }, 'Continuar comprando')));
}

// ------------------------------------------------------------------ montagem
function renderTelaForm() {
  montar(
    principal,
    h('div', { class: 'container' },
      h('div', { class: 'fluxo-topo' }, h('h1', {}, 'Finalizar compra'), passos(3)),
      h('div', { class: 'fluxo' }, h('div', { class: 'fluxo-principal' }, areaErro, areaEndereco, areaFrete, areaPagamento), areaResumo)),
  );
  renderEndereco();
  renderFrete();
  renderPagamentoBase();
  renderErro();
  renderResumo();
}

function render() {
  document.body.querySelector('.barra-fluxo')?.remove();
  if (estado.tela === 'form') return renderTelaForm();
  document.body.classList.remove('com-barra-fluxo');
  const conteudo = { pix: telaPix, boleto: telaBoleto, sucesso: telaSucesso,
    analise: () => telaSimples('Pagamento em análise', 'Estamos aguardando a resposta da operadora do cartão. Esta tela atualiza sozinha quando houver novidades.', h('span', { class: 'status-espera', role: 'status' }, h('span', { class: 'pulso' }), 'Em análise')),
    cancelado: () => telaSimples('Pedido cancelado', 'O pedido foi cancelado e os itens voltaram ao estoque. Você pode montar uma nova sacola quando quiser.', h('a', { class: 'btn btn-ouro', href: 'index.html?todos=1' }, 'Voltar à loja')) }[estado.tela]();
  montar(principal, h('div', { class: 'container' }, h('div', { class: 'fluxo-topo' }, h('h1', {}, estado.tela === 'sucesso' ? 'Compra concluída' : 'Pagamento'), passos(estado.tela === 'sucesso' ? 4 : 3)), h('div', { class: 'auth-centro' }, conteudo)));
  window.scrollTo({ top: 0 });
  principal.focus({ preventScroll: true });
}

async function iniciar() {
  document.title = 'Pagamento | Savordelli';
  montar(principal, h('div', { class: 'container' }, h('div', { class: 'fluxo-topo' }, h('h1', {}, 'Finalizar compra')), h('div', { class: 'skeleton', 'aria-hidden': 'true' })));
  await casca.pronta;
  if (!logado()) return irParaIdentificacao('checkout.html');

  try {
    const pref = lerCheckout();
    const [carrinho, enderecos, config] = await Promise.all([
      obterCarrinho(pref.cupom), listarEnderecos(),
      configPagamento().catch(() => ({ modo: 'simulado', public_key: null })),
    ]);
    if (!carrinho.itens.length) return window.location.replace('sacola.html');
    if (pref.cupom && carrinho.cupom && !carrinho.cupom.valido) salvarCheckout({ cupom: null });
    estado.carrinho = carrinho;
    estado.enderecos = enderecos.itens;
    estado.config = config;
    estado.enderecoId = String((enderecos.itens.find((e) => String(e.id) === String(pref.enderecoId)) || enderecos.itens.find((e) => e.padrao) || enderecos.itens[0])?.id ?? '') || null;
    estado.formEndereco = enderecos.itens.length === 0;
  } catch (e) {
    montar(principal, h('div', { class: 'container secao' }, h('div', { class: 'vazio' }, h('strong', {}, 'Não foi possível carregar o checkout'), h('p', {}, e.message), h('p', {}, h('a', { class: 'link-sutil', href: 'sacola.html' }, 'Voltar à sacola')))));
    return;
  }
  render();
  if (estado.carrinho.tem_problemas) { estado.erro = 'Há itens indisponíveis na sacola. Revise antes de pagar.'; estado.erroSacola = true; renderErro(); }
  await Promise.all([cotar(), casca.carregarCategorias(), casca.carregarMarcas()]);
}

iniciar();
