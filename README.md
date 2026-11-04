# Savordelli Cosmeticos - E-commerce

Stack: Node.js, Express, MySQL 8, Vanilla JS.

Integracoes: Mercado Pago (pagamentos), Melhor Envio (frete), Bling ERP (fonte de verdade do estoque).

## Estrutura

- `backend/` API Express (routes, controllers, services, repositories, integrations, jobs)
- `frontend/loja/` vitrine publica
- `frontend/admin/` painel administrativo (Dark Mode)
- `frontend/shared/` codigo JS/CSS compartilhado
- `database/` schema e migrations
- `docs/` documentacao

## Testes

```
cd backend
npm test                       # unitarios (testes de integracao sao ignorados)
```

Testes de integracao usam MySQL real e TRUNCAM as tabelas: aponte para um banco descartavel.

```
docker run -d --name sv_test_mysql -e MYSQL_ROOT_PASSWORD=testpw -e MYSQL_DATABASE=sv_test -p 3390:3306 mysql:8.0
docker exec -i sv_test_mysql mysql -uroot -ptestpw sv_test < database/schema.sql
SV_TEST_DB=1 DB_HOST=127.0.0.1 DB_PORT=3390 DB_USER=root DB_PASSWORD=testpw DB_NAME=sv_test npm test
```

Sem `MELHOR_ENVIO_TOKEN` / `MERCADOPAGO_ACCESS_TOKEN` (fora de producao) a API usa frete e gateway SIMULADOS.

## Painel administrativo

HTML/CSS/JS puro (sem build), Dark Mode, menu lateral e cards. E servido pela propria API:

```
cd backend && npm run dev
# abra http://localhost:3000/painel/
```

Estrutura: `frontend/admin/{index.html, app.html, css/, js/core/, js/modules/}`. O token de acesso fica so em memoria;
o refresh e um cookie httpOnly. O menu respeita as permissoes do papel (a autorizacao real e feita pela API).
Crie o primeiro admin com `node scripts/criar-usuario.js admin <email> "<Nome>" admin <senha>`.

## Integracao Bling

Fila (`bling_sync_fila`) consumida pelo worker (`backend/src/jobs/blingWorker.js`); webhook de entrada em
`POST /webhooks/bling`; reconciliacao de estoque a cada 6 horas. Cada variacao (SKU) vira um produto simples no
Bling, casado pelo codigo. Variaveis: `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI`, `BLING_DEPOSITO_ID`.
Conexao OAuth2 pelo painel (Integracao Bling > Conectar). Sem credenciais, fora de producao, usa um Bling simulado.

## LGPD

Direitos do titular implementados em `backend/src/services/lgpd.service.js`:

- Acesso e portabilidade: `GET /cliente/lgpd/exportar` (JSON completo, sem hashes ou segredos).
- Consentimento: `GET/PUT /cliente/lgpd/consentimentos` (registro append-only; revogacao gera solicitacao concluida).
- Solicitacoes com prazo de 15 dias: `GET/POST /cliente/lgpd/solicitacoes`; fila e tratamento em `/admin/lgpd/solicitacoes` (permissao `lgpd.gerenciar`).
- Eliminacao: `POST /cliente/lgpd/anonimizar` (senha + confirmacao) ou `POST /admin/lgpd/clientes/:id/anonimizar`. Anonimiza o cadastro,
  apaga enderecos e carrinho, revoga sessoes. Bloqueia se houver pedido em andamento.
- Guarda fiscal: pedidos pagos mantem nome, CPF (cifrado) e endereco por 5 anos (art. 16, I); depois um job diario apaga esses snapshots.
  Pedidos nunca pagos tem os snapshots apagados na hora. A prova de consentimento e preservada.

## Vitrine da loja

HTML/CSS/JS puro em `frontend/loja/`, servida pela API em `/loja/` (a raiz `/` redireciona para ela):

```
cd backend && npm run dev
# abra http://localhost:3000/
```

Paginas: `index.html` (home, busca e listagem por categoria) e `produto.html?slug=...`. Design System "Ouro sobre creme" em
`css/tokens.css` (variaveis `:root`). Regras de conversao: um unico botao ouro por tela; barra fixa de compra no mobile; faixa de
confianca junto ao botao. Enquanto o catalogo estiver vazio (ou a API fora do ar) a vitrine exibe produtos de demonstracao
(`js/mock.js`); desligue com `DEMO_SE_VAZIO: false` em `js/config.js`.

### Fluxo de compra (vitrine)

`produto.html` -> `sacola.html` (itens, quantidade, cupom, frete) -> `identificacao.html` (login/cadastro com CPF e consentimentos
LGPD) -> `checkout.html` (endereco, entrega, Pix / cartao / boleto). Marcas revendidas: `database/seeds/001_marcas.sql`.

Pagamento: sem `MERCADOPAGO_ACCESS_TOKEN` (fora de producao) o gateway e SIMULADO e o checkout mostra um botao "Simular pagamento
aprovado" para Pix/boleto; use o cartao 4000 0000 0000 0002 para simular recusa. Com credenciais, defina tambem
`MERCADOPAGO_PUBLIC_KEY` (campos seguros do cartao; o numero do cartao nunca passa pelo servidor da loja).
