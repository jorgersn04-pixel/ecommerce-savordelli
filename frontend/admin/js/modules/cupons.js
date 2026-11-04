import { get, post, put } from '../core/api.js';
import { h, cartao, tabela, badge, botao, campo, modal, executar, cabecalhoPagina, montar, carregando } from '../core/ui.js';
import { moeda, dataHora, paraInputLocal, deInputLocal, TIPO_CUPOM, numero } from '../core/format.js';
import { temPermissao } from '../core/auth.js';

function descricaoBeneficio(c) {
  if (c.tipo === 'percentual') return `${Number(c.valor)}% de desconto`;
  if (c.tipo === 'valor_fixo') return `${moeda(c.valor)} de desconto`;
  return 'Frete gratis (opcao mais barata)';
}

export async function render(container) {
  const area = h('div', {});
  const podeGerenciar = temPermissao('cupons.gerenciar');

  async function carregar() {
    montar(area, carregando());
    const { itens } = await get('/admin/cupons');
    montar(
      area,
      tabela({
        colunas: [
          { titulo: 'Codigo', render: (c) => h('span', { class: 'mono cell-main' }, c.codigo) },
          { titulo: 'Beneficio', render: (c) => h('div', {}, h('div', {}, descricaoBeneficio(c)), h('div', { class: 'cell-sub' }, TIPO_CUPOM[c.tipo])) },
          { titulo: 'Pedido minimo', classe: 'right nowrap', render: (c) => (c.pedido_minimo ? moeda(c.pedido_minimo) : '-') },
          { titulo: 'Usos', classe: 'right', render: (c) => `${numero(c.usos)}${c.limite_usos ? ` / ${numero(c.limite_usos)}` : ''}` },
          { titulo: 'Validade', render: (c) => h('span', { class: 'cell-sub' }, c.valido_ate ? `ate ${dataHora(c.valido_ate)}` : 'Sem prazo') },
          { titulo: 'Situacao', render: (c) => (c.ativo ? badge('Ativo', 'ok') : badge('Inativo', 'danger')) },
          { titulo: '', classe: 'right', render: (c) => (podeGerenciar ? botao('Editar', { small: true, icon: 'editar', onClick: () => abrir(c) }) : '') },
        ],
        linhas: itens,
        vazioTitulo: 'Nenhum cupom cadastrado',
        vazioTexto: 'Crie cupons de percentual, valor fixo ou frete gratis.',
      }),
    );
  }

  function abrir(c = null) {
    const f = {
      codigo: campo({ rotulo: 'Codigo', nome: 'codigo', valor: c?.codigo || '', requerido: true, dica: 'Sera convertido para maiusculas' }),
      tipo: campo({ rotulo: 'Tipo', nome: 'tipo', tipo: 'select', valor: c?.tipo || 'percentual', opcoes: Object.entries(TIPO_CUPOM).map(([valor, rotulo]) => ({ valor, rotulo })) }),
      valor: campo({ rotulo: 'Valor (% ou R$)', nome: 'valor', tipo: 'number', passo: '0.01', min: '0', valor: c ? Number(c.valor) : '', dica: 'Ignorado para frete gratis' }),
      minimo: campo({ rotulo: 'Pedido minimo (R$)', nome: 'minimo', tipo: 'number', passo: '0.01', min: '0', valor: c?.pedido_minimo ?? '' }),
      limite: campo({ rotulo: 'Limite de usos', nome: 'limite', tipo: 'number', min: '1', valor: c?.limite_usos ?? '', dica: 'Vazio = ilimitado' }),
      de: campo({ rotulo: 'Valido a partir de', nome: 'de', tipo: 'datetime-local', valor: paraInputLocal(c?.valido_de) }),
      ate: campo({ rotulo: 'Valido ate', nome: 'ate', tipo: 'datetime-local', valor: paraInputLocal(c?.valido_ate) }),
      ativo: campo({ rotulo: 'Cupom ativo', nome: 'ativo', tipo: 'checkbox', valor: c ? Boolean(c.ativo) : true }),
    };
    const num = (x) => (x.input.value === '' ? null : Number(x.input.value));

    modal({
      titulo: c ? `Editar cupom ${c.codigo}` : 'Novo cupom',
      largo: true,
      corpo: h('div', { class: 'form-grid' }, f.codigo.el, f.tipo.el, f.valor.el, f.minimo.el, f.limite.el, f.ativo.el, f.de.el, f.ate.el),
      acoes: [
        { rotulo: 'Cancelar', aoClicar: (fechar) => fechar() },
        {
          rotulo: 'Salvar',
          tipo: 'primary',
          aoClicar: async (fechar, btn) => {
            const corpo = {
              codigo: f.codigo.input.value.trim(),
              tipo: f.tipo.input.value,
              valor: f.tipo.input.value === 'frete_gratis' ? 0 : (num(f.valor) ?? 0),
              pedido_minimo: num(f.minimo),
              limite_usos: num(f.limite),
              valido_de: deInputLocal(f.de.input.value),
              valido_ate: deInputLocal(f.ate.input.value),
              ativo: f.ativo.input.checked,
            };
            const ok = await executar(btn, () => (c ? put(`/admin/cupons/${c.id}`, corpo) : post('/admin/cupons', corpo)), { sucesso: c ? 'Cupom atualizado' : 'Cupom criado' });
            if (ok !== undefined) {
              fechar();
              await carregar();
            }
          },
        },
      ],
    });
  }

  container.append(
    cabecalhoPagina('Cupons', 'Descontos aplicados no carrinho e no checkout.', podeGerenciar ? botao('Novo cupom', { tipo: 'primary', icon: 'mais', onClick: () => abrir() }) : null),
    cartao(null, area, { plano: true }),
  );
  await carregar();
}
