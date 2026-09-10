-- F16 (P0.4, PR 6): robustez do canal WhatsApp.
--
-- A migration é aditiva e compatível com o código anterior: a tabela nova não
-- é consultada por ele, as três colunas de estado nascem nulas e o valor novo
-- do enum só é escrito pela nova versão.

-- Claim persistente, insert-first, para uma reentrega do mesmo webhook não
-- atravessar transcrição + IA duas vezes — inclusive após restart ou em duas
-- réplicas da API.
CREATE TABLE IF NOT EXISTS "inbound_message" (
  "id" UUID NOT NULL,
  "clinic_id" UUID NOT NULL,
  "external_id" TEXT NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inbound_message_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inbound_message_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "inbound_message_clinic_id_external_id_key"
  ON "inbound_message"("clinic_id", "external_id");
CREATE INDEX IF NOT EXISTS "inbound_message_processed_at_idx"
  ON "inbound_message"("processed_at");

-- Estado observado pelo polling do servidor. `whatsapp_state_at` só muda na
-- transição, então o aviso não renasce como "novo" a cada tique do cron.
ALTER TABLE "clinic_settings" ADD COLUMN IF NOT EXISTS "whatsapp_state" TEXT;
ALTER TABLE "clinic_settings" ADD COLUMN IF NOT EXISTS "whatsapp_state_at" TIMESTAMP(3);
ALTER TABLE "clinic_settings" ADD COLUMN IF NOT EXISTS "whatsapp_last_error" TEXT;

-- Resposta reativa que falhou no envio direto entra na mesma fila idempotente
-- das automações, mas ignora a janela de disparo ativo.
ALTER TYPE "automation_kind" ADD VALUE IF NOT EXISTS 'resposta_ia';
