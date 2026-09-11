-- P1.1 (PR 10): registra a revisão humana das automações.
--
-- A linha de `automation_settings` é criada automaticamente pelo planejador;
-- `created_at`/`updated_at` não distinguem essa criação de um salvamento feito
-- pelo dono. A coluna nasce nula e só o PATCH /automations a preenche.
--
-- Aditiva e compatível com a versão anterior da API.
ALTER TABLE "automation_settings"
ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);
