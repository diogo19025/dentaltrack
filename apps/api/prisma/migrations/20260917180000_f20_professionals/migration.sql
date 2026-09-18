-- F20: cadastro espelhado de profissionais.
--
-- A agenda do sistema de gestão é por profissional, e a conta real tem dez.
-- O produto só conhecia um: `clinic_integration.professional_id` guarda um
-- único profissional padrão, e todo agendamento do agente caía nele. Sem uma
-- tabela por trás, `appointment.professional_external_id` e
-- `professional_name` eram texto solto vindo da sincronização — não dava para
-- filtrar a agenda por profissional, nem colorir, nem oferecer escolha.
--
-- `professional` é espelho, não fonte: `external_id` amarra a linha ao
-- provedor e quem some da conta do cliente vira `active = false` em vez de ser
-- apagado, porque os agendamentos passados apontam para ele. `external_id`
-- nulo é o cadastro manual (empresa sem integração também tem equipe) — e em
-- Postgres nulo não colide com nulo, então vários convivem sob o índice único.
--
-- Aditiva e compatível com a versão anterior do código: a FK em `appointment`
-- é nula e as duas colunas de texto continuam onde estavam, então nenhuma
-- linha existente é reescrita e a API anterior segue funcionando.
CREATE TABLE IF NOT EXISTS "professional" (
  "id"               UUID         NOT NULL,
  "clinic_id"        UUID         NOT NULL,
  "external_id"      TEXT,
  "name"             TEXT         NOT NULL,
  "active"           BOOLEAN      NOT NULL DEFAULT true,
  "unit_external_id" TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "professional_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "professional"
    ADD CONSTRAINT "professional_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "professional_clinic_id_external_id_key"
  ON "professional" ("clinic_id", "external_id");

CREATE INDEX IF NOT EXISTS "professional_clinic_id_active_idx"
  ON "professional" ("clinic_id", "active");

-- Agendamento aponta para o profissional. Opcional de propósito: o histórico
-- anterior ao cadastro só tem o texto, e reescrevê-lo não acrescenta nada.
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "professional_id" UUID;

DO $$
BEGIN
  ALTER TABLE "appointment"
    ADD CONSTRAINT "appointment_professional_id_fkey"
    FOREIGN KEY ("professional_id") REFERENCES "professional"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "appointment_clinic_id_professional_id_starts_at_idx"
  ON "appointment" ("clinic_id", "professional_id", "starts_at");

-- Categoria de agenda aplicada ao que o agente marca. Sem ela o agendamento
-- entra sem categoria e aparece sem cor na agenda do cliente.
ALTER TABLE "clinic_integration"
  ADD COLUMN IF NOT EXISTS "category_external_id" TEXT;

-- O que o agente faz quando há vários profissionais e o cliente não pediu
-- nenhum. Mora em clinic_settings, e não na integração, porque é
-- comportamento do agente: as linhas de clinic_integration são por provedor e
-- a configuração sumiria ao trocar de agenda. TEXT, e não enum, para a
-- migration continuar aditiva.
ALTER TABLE "clinic_settings"
  ADD COLUMN IF NOT EXISTS "professional_policy" TEXT NOT NULL DEFAULT 'primeiro_livre';
