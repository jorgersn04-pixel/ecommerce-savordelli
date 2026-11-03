-- =====================================================================
-- Savordelli Cosmeticos - Modelo logico inicial (MySQL 8.0+, InnoDB, utf8mb4)
-- Convencoes: tabelas em snake_case plural, PK `id` BIGINT UNSIGNED,
-- dinheiro em DECIMAL(10,2), datas em UTC (TIMESTAMP), soft delete via `excluido_em`.
-- =====================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. USUARIOS E ACESSO
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome             VARCHAR(150) NOT NULL,
  email            VARCHAR(190) NOT NULL,
  senha_hash       VARCHAR(255) NOT NULL,              -- argon2id/bcrypt
  cpf_cifrado      VARBINARY(255) NULL,                -- AES-256-GCM (chave fora do banco)
  cpf_hash         CHAR(64) NULL,                      -- HMAC-SHA256 para busca/unicidade
  telefone         VARCHAR(20) NULL,
  data_nascimento  DATE NULL,
  email_verificado_em TIMESTAMP NULL,
  bling_contato_id BIGINT UNSIGNED NULL,
  anonimizado_em   TIMESTAMP NULL,                     -- LGPD: direito ao esquecimento
  criado_em        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_clientes_email (email),
  UNIQUE KEY uk_clientes_cpf_hash (cpf_hash),
  KEY idx_clientes_bling (bling_contato_id)
) ENGINE=InnoDB;

CREATE TABLE enderecos (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id    BIGINT UNSIGNED NOT NULL,
  apelido       VARCHAR(50) NULL,
  destinatario  VARCHAR(150) NOT NULL,
  cep           CHAR(8) NOT NULL,
  logradouro    VARCHAR(190) NOT NULL,
  numero        VARCHAR(20) NOT NULL,
  complemento   VARCHAR(100) NULL,
  bairro        VARCHAR(100) NOT NULL,
  cidade        VARCHAR(100) NOT NULL,
  uf            CHAR(2) NOT NULL,
  padrao        TINYINT(1) NOT NULL DEFAULT 0,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_enderecos_cliente (cliente_id),
  CONSTRAINT fk_enderecos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE papeis (
  id    SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome  VARCHAR(50) NOT NULL UNIQUE,                   -- admin, operador, financeiro
  permissoes JSON NOT NULL
) ENGINE=InnoDB;

CREATE TABLE admin_usuarios (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  papel_id    SMALLINT UNSIGNED NOT NULL,
  nome        VARCHAR(150) NOT NULL,
  email       VARCHAR(190) NOT NULL UNIQUE,
  senha_hash  VARCHAR(255) NOT NULL,
  totp_segredo_cifrado VARBINARY(255) NULL,            -- 2FA
  ativo       TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_login_em TIMESTAMP NULL,
  criado_em   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_papel FOREIGN KEY (papel_id) REFERENCES papeis(id)
) ENGINE=InnoDB;

CREATE TABLE sessoes_refresh (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo_usuario ENUM('cliente','admin') NOT NULL,
  usuario_id  BIGINT UNSIGNED NOT NULL,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,            -- argon2id do segredo (token = id.segredo)
  ip          VARBINARY(16) NULL,
  user_agent  VARCHAR(255) NULL,
  expira_em   TIMESTAMP NOT NULL,
  revogado_em TIMESTAMP NULL,
  KEY idx_sessoes_usuario (tipo_usuario, usuario_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. CATALOGO
-- ---------------------------------------------------------------------
CREATE TABLE marcas (
  id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nome  VARCHAR(100) NOT NULL UNIQUE,                  -- O Boticario, Eudora, Quem disse Berenice...
  slug  VARCHAR(120) NOT NULL UNIQUE,
  ativo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE categorias (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pai_id    BIGINT UNSIGNED NULL,
  nome      VARCHAR(100) NOT NULL,
  slug      VARCHAR(120) NOT NULL UNIQUE,
  ordem     INT NOT NULL DEFAULT 0,
  ativo     TINYINT(1) NOT NULL DEFAULT 1,
  bling_categoria_id BIGINT UNSIGNED NULL,
  CONSTRAINT fk_categorias_pai FOREIGN KEY (pai_id) REFERENCES categorias(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE produtos (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  marca_id      BIGINT UNSIGNED NULL,
  nome          VARCHAR(200) NOT NULL,
  slug          VARCHAR(220) NOT NULL UNIQUE,
  descricao_curta VARCHAR(500) NULL,
  descricao     MEDIUMTEXT NULL,
  ncm           CHAR(8) NULL,                          -- necessario para NF-e
  origem_fiscal TINYINT UNSIGNED NULL,
  status        ENUM('rascunho','ativo','inativo') NOT NULL DEFAULT 'rascunho',
  bling_produto_id BIGINT UNSIGNED NULL,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  excluido_em   TIMESTAMP NULL,
  KEY idx_produtos_status (status),
  KEY idx_produtos_bling (bling_produto_id),
  FULLTEXT KEY ft_produtos_busca (nome, descricao_curta),
  CONSTRAINT fk_produtos_marca FOREIGN KEY (marca_id) REFERENCES marcas(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE produto_categorias (
  produto_id   BIGINT UNSIGNED NOT NULL,
  categoria_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (produto_id, categoria_id),
  CONSTRAINT fk_pc_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_categoria FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Variacao = unidade vendavel (SKU). Todo produto tem ao menos 1 variacao.
CREATE TABLE produto_variacoes (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  produto_id    BIGINT UNSIGNED NOT NULL,
  sku           VARCHAR(60) NOT NULL UNIQUE,
  ean           VARCHAR(14) NULL,
  atributos     JSON NULL,                             -- {"tom":"Bege 20","volume_ml":30}
  preco         DECIMAL(10,2) NOT NULL,
  preco_promocional DECIMAL(10,2) NULL,
  custo         DECIMAL(10,2) NULL,
  peso_g        INT UNSIGNED NOT NULL,                 -- obrigatorios p/ frete
  altura_cm     DECIMAL(6,2) NOT NULL,
  largura_cm    DECIMAL(6,2) NOT NULL,
  comprimento_cm DECIMAL(6,2) NOT NULL,
  estoque_disponivel INT NOT NULL DEFAULT 0,           -- saldo vendavel (espelho do Bling)
  estoque_reservado  INT NOT NULL DEFAULT 0,           -- reservado por pedidos em aberto
  ativo         TINYINT(1) NOT NULL DEFAULT 1,
  bling_variacao_id BIGINT UNSIGNED NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_variacoes_produto (produto_id),
  KEY idx_variacoes_bling (bling_variacao_id),
  CONSTRAINT fk_variacoes_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
  CONSTRAINT ck_variacoes_estoque CHECK (estoque_disponivel >= 0 AND estoque_reservado >= 0)
) ENGINE=InnoDB;

CREATE TABLE produto_imagens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  produto_id  BIGINT UNSIGNED NOT NULL,
  variacao_id BIGINT UNSIGNED NULL,
  url         VARCHAR(500) NOT NULL,
  texto_alternativo VARCHAR(200) NULL,
  ordem       INT NOT NULL DEFAULT 0,
  principal   TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_img_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
  CONSTRAINT fk_img_variacao FOREIGN KEY (variacao_id) REFERENCES produto_variacoes(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE estoque_movimentacoes (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  variacao_id BIGINT UNSIGNED NOT NULL,
  tipo        ENUM('entrada','saida','reserva','liberacao','ajuste','sync_bling') NOT NULL,
  quantidade  INT NOT NULL,
  saldo_apos  INT NOT NULL,
  pedido_id   BIGINT UNSIGNED NULL,
  origem      VARCHAR(50) NOT NULL,                    -- loja, admin, bling
  criado_em   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mov_variacao (variacao_id, criado_em),
  CONSTRAINT fk_mov_variacao FOREIGN KEY (variacao_id) REFERENCES produto_variacoes(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. CARRINHO, CUPONS E FRETE
-- ---------------------------------------------------------------------
CREATE TABLE carrinhos (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token       CHAR(36) NOT NULL UNIQUE,                -- cookie de carrinho anonimo
  cliente_id  BIGINT UNSIGNED NULL,
  cep_destino CHAR(8) NULL,
  status      ENUM('aberto','convertido','abandonado') NOT NULL DEFAULT 'aberto',
  criado_em   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_carrinhos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE carrinho_itens (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  carrinho_id BIGINT UNSIGNED NOT NULL,
  variacao_id BIGINT UNSIGNED NOT NULL,
  quantidade  INT UNSIGNED NOT NULL,
  UNIQUE KEY uk_carrinho_variacao (carrinho_id, variacao_id),
  CONSTRAINT fk_ci_carrinho FOREIGN KEY (carrinho_id) REFERENCES carrinhos(id) ON DELETE CASCADE,
  CONSTRAINT fk_ci_variacao FOREIGN KEY (variacao_id) REFERENCES produto_variacoes(id)
) ENGINE=InnoDB;

CREATE TABLE cupons (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo      VARCHAR(40) NOT NULL UNIQUE,
  tipo        ENUM('percentual','valor_fixo','frete_gratis') NOT NULL,
  valor       DECIMAL(10,2) NOT NULL DEFAULT 0,
  pedido_minimo DECIMAL(10,2) NULL,
  limite_usos INT UNSIGNED NULL,
  usos        INT UNSIGNED NOT NULL DEFAULT 0,
  valido_de   TIMESTAMP NULL,
  valido_ate  TIMESTAMP NULL,
  ativo       TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

-- Cache de cotacoes dos Correios (evita estourar limite da API e acelera o carrinho)
CREATE TABLE frete_cotacoes_cache (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chave_hash    CHAR(64) NOT NULL UNIQUE,              -- hash(cep_origem|cep_destino|peso|dimensoes|servico)
  cep_destino   CHAR(8) NOT NULL,
  servico_codigo VARCHAR(20) NOT NULL,                 -- PAC, SEDEX...
  valor         DECIMAL(10,2) NOT NULL,
  prazo_dias    SMALLINT UNSIGNED NOT NULL,
  expira_em     TIMESTAMP NOT NULL,
  KEY idx_frete_expira (expira_em)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. PEDIDOS
-- ---------------------------------------------------------------------
CREATE TABLE pedidos (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numero          VARCHAR(20) NOT NULL UNIQUE,         -- numero publico (ex: SV-2026-000123)
  cliente_id      BIGINT UNSIGNED NULL,                -- NULL apos anonimizacao
  cupom_id        BIGINT UNSIGNED NULL,
  status          ENUM('aguardando_pagamento','pago','em_separacao','enviado','entregue','cancelado','reembolsado')
                  NOT NULL DEFAULT 'aguardando_pagamento',
  subtotal        DECIMAL(10,2) NOT NULL,
  desconto        DECIMAL(10,2) NOT NULL DEFAULT 0,
  frete_valor     DECIMAL(10,2) NOT NULL DEFAULT 0,
  total           DECIMAL(10,2) NOT NULL,
  -- Snapshot do cliente/endereco no momento da compra (imutavel, exigencia fiscal)
  snapshot_cliente  JSON NOT NULL,
  snapshot_endereco JSON NOT NULL,
  frete_servico   VARCHAR(20) NULL,
  frete_prazo_dias SMALLINT UNSIGNED NULL,
  bling_pedido_id BIGINT UNSIGNED NULL,
  criado_em       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pedidos_cliente (cliente_id),
  KEY idx_pedidos_status (status, criado_em),
  KEY idx_pedidos_bling (bling_pedido_id),
  CONSTRAINT fk_pedidos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL,
  CONSTRAINT fk_pedidos_cupom FOREIGN KEY (cupom_id) REFERENCES cupons(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE pedido_itens (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pedido_id     BIGINT UNSIGNED NOT NULL,
  variacao_id   BIGINT UNSIGNED NULL,
  sku           VARCHAR(60) NOT NULL,                  -- snapshot
  nome          VARCHAR(250) NOT NULL,                 -- snapshot
  quantidade    INT UNSIGNED NOT NULL,
  preco_unitario DECIMAL(10,2) NOT NULL,
  total         DECIMAL(10,2) NOT NULL,
  KEY idx_pi_pedido (pedido_id),
  CONSTRAINT fk_pi_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_variacao FOREIGN KEY (variacao_id) REFERENCES produto_variacoes(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE pedido_historico_status (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pedido_id  BIGINT UNSIGNED NOT NULL,
  status_de  VARCHAR(30) NULL,
  status_para VARCHAR(30) NOT NULL,
  autor      VARCHAR(100) NULL,                        -- admin:12 | sistema | bling | gateway
  observacao VARCHAR(500) NULL,
  criado_em  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_hist_pedido (pedido_id),
  CONSTRAINT fk_hist_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Gateway ainda nao definido: tabela agnostica ao provedor.
CREATE TABLE pagamentos (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pedido_id     BIGINT UNSIGNED NOT NULL,
  metodo        ENUM('pix','cartao_credito','boleto') NOT NULL,
  provedor      VARCHAR(40) NOT NULL,
  provedor_transacao_id VARCHAR(100) NULL,
  valor         DECIMAL(10,2) NOT NULL,
  parcelas      TINYINT UNSIGNED NOT NULL DEFAULT 1,
  status        ENUM('pendente','aprovado','recusado','estornado','expirado') NOT NULL DEFAULT 'pendente',
  pago_em       TIMESTAMP NULL,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pag_provedor (provedor, provedor_transacao_id),
  CONSTRAINT fk_pag_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
) ENGINE=InnoDB;

CREATE TABLE envios (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pedido_id     BIGINT UNSIGNED NOT NULL,
  servico       VARCHAR(20) NOT NULL,
  codigo_rastreio VARCHAR(20) NULL,
  etiqueta_url  VARCHAR(500) NULL,
  status        ENUM('pendente','postado','em_transito','entregue','devolvido') NOT NULL DEFAULT 'pendente',
  postado_em    TIMESTAMP NULL,
  entregue_em   TIMESTAMP NULL,
  KEY idx_envios_rastreio (codigo_rastreio),
  CONSTRAINT fk_envios_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. INTEGRACAO BLING ERP
-- ---------------------------------------------------------------------
CREATE TABLE bling_credenciais (
  id                    TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,   -- linha unica
  access_token_cifrado  VARBINARY(2048) NOT NULL,
  refresh_token_cifrado VARBINARY(2048) NOT NULL,
  expira_em             TIMESTAMP NOT NULL,
  atualizado_em         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT ck_bling_singleton CHECK (id = 1)
) ENGINE=InnoDB;

-- Outbox: tudo que a loja precisa enviar ao Bling passa por aqui (retry + idempotencia)
CREATE TABLE bling_sync_fila (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entidade      ENUM('produto','estoque','pedido','contato','nota_fiscal') NOT NULL,
  entidade_id   BIGINT UNSIGNED NOT NULL,
  operacao      ENUM('criar','atualizar','excluir','emitir_nfe') NOT NULL,
  payload       JSON NULL,
  status        ENUM('pendente','processando','sucesso','erro','morto') NOT NULL DEFAULT 'pendente',
  tentativas    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  proxima_tentativa_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_erro   TEXT NULL,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fila_proc (status, proxima_tentativa_em),
  KEY idx_fila_entidade (entidade, entidade_id)
) ENGINE=InnoDB;

CREATE TABLE bling_sync_logs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fila_id     BIGINT UNSIGNED NULL,
  direcao     ENUM('saida','entrada') NOT NULL,        -- loja->Bling | Bling->loja (webhook/polling)
  endpoint    VARCHAR(200) NOT NULL,
  http_status SMALLINT NULL,
  duracao_ms  INT UNSIGNED NULL,
  resumo      VARCHAR(500) NULL,
  criado_em   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_bsl_fila (fila_id)
) ENGINE=InnoDB;

CREATE TABLE bling_webhook_eventos (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  evento_id   VARCHAR(100) NOT NULL UNIQUE,            -- idempotencia: ignora reentregas
  tipo        VARCHAR(60) NOT NULL,                    -- ex: stock.updated, product.updated
  payload     JSON NOT NULL,
  processado_em TIMESTAMP NULL,
  recebido_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE notas_fiscais (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pedido_id     BIGINT UNSIGNED NOT NULL,
  bling_nfe_id  BIGINT UNSIGNED NULL,
  numero        VARCHAR(20) NULL,
  serie         VARCHAR(5) NULL,
  chave_acesso  CHAR(44) NULL UNIQUE,
  status        ENUM('pendente','autorizada','rejeitada','cancelada') NOT NULL DEFAULT 'pendente',
  xml_url       VARCHAR(500) NULL,
  danfe_url     VARCHAR(500) NULL,
  motivo_rejeicao VARCHAR(500) NULL,
  emitida_em    TIMESTAMP NULL,
  CONSTRAINT fk_nf_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. LGPD
-- ---------------------------------------------------------------------
CREATE TABLE consentimento_finalidades (
  id          SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo      VARCHAR(40) NOT NULL UNIQUE,             -- essencial, analytics, marketing, personalizacao
  nome        VARCHAR(100) NOT NULL,
  descricao   VARCHAR(500) NOT NULL,
  obrigatorio TINYINT(1) NOT NULL DEFAULT 0,
  base_legal  VARCHAR(60) NOT NULL                     -- consentimento, execucao_contrato, legitimo_interesse
) ENGINE=InnoDB;

CREATE TABLE documentos_legais (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo        ENUM('politica_privacidade','termos_uso','politica_cookies') NOT NULL,
  versao      VARCHAR(20) NOT NULL,
  conteudo    MEDIUMTEXT NOT NULL,
  vigente_desde TIMESTAMP NOT NULL,
  UNIQUE KEY uk_doc_versao (tipo, versao)
) ENGINE=InnoDB;

-- Registro imutavel (append-only): prova do consentimento
CREATE TABLE consentimentos_registro (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id    BIGINT UNSIGNED NULL,
  visitante_id  CHAR(36) NULL,                         -- UUID do cookie, para visitante anonimo
  finalidade_id SMALLINT UNSIGNED NOT NULL,
  documento_id  BIGINT UNSIGNED NULL,                  -- versao do documento aceita
  concedido     TINYINT(1) NOT NULL,
  ip_hash       CHAR(64) NULL,
  user_agent    VARCHAR(255) NULL,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cons_cliente (cliente_id, finalidade_id, criado_em),
  KEY idx_cons_visitante (visitante_id),
  CONSTRAINT fk_cons_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL,
  CONSTRAINT fk_cons_finalidade FOREIGN KEY (finalidade_id) REFERENCES consentimento_finalidades(id),
  CONSTRAINT fk_cons_documento FOREIGN KEY (documento_id) REFERENCES documentos_legais(id)
) ENGINE=InnoDB;

CREATE TABLE solicitacoes_titular (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cliente_id  BIGINT UNSIGNED NOT NULL,
  tipo        ENUM('acesso','correcao','exclusao','portabilidade','revogacao') NOT NULL,
  status      ENUM('aberta','em_analise','concluida','negada') NOT NULL DEFAULT 'aberta',
  detalhes    VARCHAR(1000) NULL,
  prazo_em    DATE NOT NULL,                           -- prazo legal de resposta
  concluida_em TIMESTAMP NULL,
  criado_em   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sol_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id)
) ENGINE=InnoDB;

CREATE TABLE logs_auditoria (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id    BIGINT UNSIGNED NULL,
  acao        VARCHAR(60) NOT NULL,                    -- cliente.visualizar, pedido.cancelar, cliente.anonimizar
  entidade    VARCHAR(40) NOT NULL,
  entidade_id BIGINT UNSIGNED NULL,
  detalhes    JSON NULL,
  ip_hash     CHAR(64) NULL,
  criado_em   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_aud_entidade (entidade, entidade_id),
  KEY idx_aud_admin (admin_id, criado_em)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- SEEDS minimos
-- ---------------------------------------------------------------------
INSERT INTO consentimento_finalidades (codigo, nome, descricao, obrigatorio, base_legal) VALUES
('essencial','Cookies essenciais','Necessarios para login, carrinho e seguranca.',1,'execucao_contrato'),
('analytics','Estatisticas de uso','Medicao anonima de navegacao para melhorar a loja.',0,'consentimento'),
('marketing','Comunicacao e anuncios','Ofertas por e-mail e anuncios personalizados.',0,'consentimento'),
('personalizacao','Personalizacao','Recomendacoes baseadas no seu historico.',0,'consentimento');

INSERT INTO papeis (nome, permissoes) VALUES
('admin','["*"]'),
('operador','["produtos.*","pedidos.*","estoque.*"]'),
('financeiro','["pedidos.ler","notas.*","relatorios.*"]');
