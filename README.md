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
