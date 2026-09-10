-- F15 (P0.2, PR 5): handoff humano — pausar a IA numa conversa.
--
-- `handoff_at` NULL significa que a IA responde, que é o estado de todas as
-- conversas existentes. Por isso a migration não precisa de backfill: a coluna
-- nasce nula e o comportamento de hoje é preservado byte a byte.
--
-- **Por que não é um `conversation_status` novo:** o handoff é ortogonal ao
-- status. Uma conversa `agendada` (terminal na máquina de estados) também pode
-- precisar de gente, e acrescentar um estado quebraria as métricas diárias, o
-- funil e o dashboard, que contam conversas por status. `can_transition` fica
-- intacto.
--
-- `handoff_by` guarda o id do usuário no Supabase Auth, sem chave estrangeira:
-- o usuário não é tabela nossa.
--
-- Aditiva e compatível com a versão anterior do código: três colunas nulas e
-- um índice.
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "handoff_at" TIMESTAMP(3);
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "handoff_by" UUID;
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "handoff_reason" TEXT;

-- Serve a pergunta que a tela e a fila de saída fazem: "quais conversas desta
-- empresa estão com atendente?". Sem ele, saber isso é varrer a tabela.
CREATE INDEX IF NOT EXISTS "conversation_clinic_id_handoff_at_idx" ON "conversation"("clinic_id", "handoff_at");
