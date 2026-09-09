-- F13 (P0.5): idempotência do agendamento.
--
-- `booking_key` é a chave estável de um agendamento (contato + quando + o quê,
-- ver agenda/appointment-keys.ts). Com o índice único abaixo, repetir a mesma
-- operação — duplo clique, retry após timeout, webhook reentregue ou o modelo
-- chamando a tool duas vezes no mesmo turno — passa a devolver o agendamento
-- que já existe em vez de criar um segundo.
--
-- Aditiva e compatível com a versão anterior do código: a coluna é nula, e em
-- Postgres nulo não colide com nulo, então as linhas já existentes (todas sem
-- chave) convivem sem violar o índice.
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "booking_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "appointment_clinic_id_booking_key_key"
  ON "appointment" ("clinic_id", "booking_key");
