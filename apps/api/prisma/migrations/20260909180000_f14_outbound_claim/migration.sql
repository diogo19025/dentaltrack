-- F14 (P0.5, PR 3): cancelar/remarcar agendamentos e claim otimista da fila.
--
-- `enviando` é o estado intermediário da fila de saída: o despachante troca
-- `pendente → enviando` num UPDATE condicional antes de chamar o WhatsApp, e
-- só prossegue se foi ele quem mudou a linha. É a única defesa contra duas
-- réplicas (ou dois tiques sobrepostos) mandarem o mesmo lembrete — a flag em
-- memória que existia só valia dentro de um processo.
--
-- `canceled_at` registra quando um agendamento foi cancelado (pela equipe na
-- tela ou pela sincronização). Cancelar o que já está cancelado é no-op e não
-- sobrescreve a data.
--
-- Aditiva e compatível com a versão anterior do código: valor novo no enum
-- (o código antigo nunca o escreve) e coluna nula.
ALTER TYPE "outbound_status" ADD VALUE IF NOT EXISTS 'enviando';

ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "canceled_at" TIMESTAMP(3);
