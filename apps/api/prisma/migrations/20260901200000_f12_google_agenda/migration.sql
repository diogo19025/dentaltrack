-- F12: Google Agenda como provedor de agenda alternativo ao Clinicorp.
-- Só amplia o enum — a tabela clinic_integration já é por (clinic_id, provider).
ALTER TYPE "integration_provider" ADD VALUE IF NOT EXISTS 'google';
