-- F21: a Data API do Supabase não alcança nenhuma tabela do produto.
--
-- O Supabase publica o schema `public` por HTTP (PostgREST) para os papéis
-- `anon` e `authenticated`, e a anon key vai embutida no front, ou seja, é
-- pública. Nada no produto lê tabela por esse caminho: a API fala com o banco
-- pelo Prisma, como dona das tabelas, e o front só usa o Auth.
--
-- A auditoria de 2026-09-27 viu, com a anon key, que as tabelas respondem
-- `200` com zero linhas: o RLS está ligado no projeto, mas por configuração
-- feita fora deste repositório, e os grants continuam lá. Um projeto recriado
-- (por exemplo, ao separar dev de prod) nasceria com o banco inteiro aberto a
-- quem tiver a anon key. Esta migration registra o bloqueio no repositório.
--
-- 1. RLS ligado em toda tabela de `public`. Sem policy, ninguém além da dona
--    lê ou escreve. O Prisma conecta como dona e não é afetado (sem FORCE).
-- 2. Sem grant para `anon` e `authenticated`, nem nas tabelas atuais nem nas
--    que migrations futuras criarem. Isso também anula qualquer policy
--    permissiva que tenha sido criada à mão no painel.
--
-- Os papéis só existem no Supabase; num Postgres comum (CI, banco local) a
-- segunda parte é pulada.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

DO $$
DECLARE
  papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', papel);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', papel);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', papel);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', papel);
    END IF;
  END LOOP;
END $$;
