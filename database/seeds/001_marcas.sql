-- Marcas revendidas pela loja (multimarcas). Idempotente: pode ser executado mais de uma vez.
--   mysql -u root -p savordelli < database/seeds/001_marcas.sql
-- Os slugs seguem a mesma regra do painel (minusculas, sem acento, hifens): "L'Occitane" -> l-occitane.
INSERT IGNORE INTO marcas (nome, slug, ativo) VALUES
  ('Natura', 'natura', 1),
  ('Avon', 'avon', 1),
  ('Eudora', 'eudora', 1),
  ('O Boticário', 'o-boticario', 1),
  ('Mahogany', 'mahogany', 1),
  ('L''Occitane', 'l-occitane', 1);
