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
