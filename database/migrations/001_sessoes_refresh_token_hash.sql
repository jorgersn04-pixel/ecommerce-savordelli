-- Argon2id gera hashes PHC de ~97 caracteres (CHAR(64) nao comporta).
-- Aplicar em bancos criados com o schema.sql anterior:
--   mysql -u root -p savordelli < database/migrations/001_sessoes_refresh_token_hash.sql
ALTER TABLE sessoes_refresh MODIFY token_hash VARCHAR(255) NOT NULL;
