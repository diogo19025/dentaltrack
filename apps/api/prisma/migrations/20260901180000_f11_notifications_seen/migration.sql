-- F11: central de notificações no sino do topbar.
--
-- As notificações são derivadas das tabelas que já existem (conversas, leads,
-- agendamentos, fila de automações) — nenhuma tabela nova. A única coisa que o
-- banco precisa guardar é o marco do "visto": eventos depois dele contam como
-- não lidos. NULL = a empresa nunca abriu o sino.

-- AlterTable
ALTER TABLE "clinic_settings" ADD COLUMN     "notifications_seen_at" TIMESTAMP(3);
