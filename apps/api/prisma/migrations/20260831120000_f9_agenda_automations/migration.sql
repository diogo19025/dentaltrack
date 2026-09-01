-- F9: Agenda com horario real, integracao com o sistema de gestao e
-- automacoes de relacionamento (lembretes, atraso, falta, retorno).
--
-- Sem backfill: os agendamentos existentes eram pedidos em texto livre
-- (preferred_time) e caem no default status = pedido, que e exatamente o que
-- eles sao. Nenhuma automacao de horario os alcanca ate ganharem starts_at.


-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('pedido', 'agendado', 'confirmado', 'compareceu', 'faltou', 'cancelado');

-- CreateEnum
CREATE TYPE "appointment_source" AS ENUM ('bot', 'integracao', 'manual');

-- CreateEnum
CREATE TYPE "integration_provider" AS ENUM ('clinicorp');

-- CreateEnum
CREATE TYPE "integration_mode" AS ENUM ('desligado', 'mock', 'live');

-- CreateEnum
CREATE TYPE "automation_kind" AS ENUM ('lembrete_3d', 'lembrete_1d', 'lembrete_1h', 'atraso', 'falta', 'retorno');

-- CreateEnum
CREATE TYPE "outbound_status" AS ENUM ('pendente', 'enviado', 'falhou', 'cancelado', 'suprimido');

-- CreateEnum
CREATE TYPE "holiday_scope" AS ENUM ('nacional', 'local');

-- AlterTable
ALTER TABLE "lead" ADD COLUMN     "external_id" TEXT;

-- AlterTable
ALTER TABLE "appointment" ADD COLUMN     "ends_at" TIMESTAMP(3),
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "last_synced_at" TIMESTAMP(3),
ADD COLUMN     "professional_external_id" TEXT,
ADD COLUMN     "professional_name" TEXT,
ADD COLUMN     "source" "appointment_source" NOT NULL DEFAULT 'bot',
ADD COLUMN     "starts_at" TIMESTAMP(3),
ADD COLUMN     "status" "appointment_status" NOT NULL DEFAULT 'pedido',
ADD COLUMN     "unit_external_id" TEXT;

-- CreateTable
CREATE TABLE "clinic_integration" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "provider" "integration_provider" NOT NULL DEFAULT 'clinicorp',
    "mode" "integration_mode" NOT NULL DEFAULT 'desligado',
    "credentials" TEXT,
    "unit_id" TEXT,
    "professional_id" TEXT,
    "status_mappings" JSONB NOT NULL DEFAULT '[]',
    "last_checked_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_settings" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "send_window_start" TEXT NOT NULL DEFAULT '08:00',
    "send_window_end" TEXT NOT NULL DEFAULT '20:00',
    "skip_holidays" BOOLEAN NOT NULL DEFAULT true,
    "skip_weekends" BOOLEAN NOT NULL DEFAULT false,
    "daily_cap" INTEGER NOT NULL DEFAULT 200,
    "reminder_3d_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder_3d_template" TEXT NOT NULL,
    "reminder_1d_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder_1d_template" TEXT NOT NULL,
    "reminder_1h_enabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder_1h_template" TEXT NOT NULL,
    "late_enabled" BOOLEAN NOT NULL DEFAULT false,
    "late_tolerance_minutes" INTEGER NOT NULL DEFAULT 15,
    "late_template" TEXT NOT NULL,
    "no_show_enabled" BOOLEAN NOT NULL DEFAULT true,
    "no_show_attempts" INTEGER NOT NULL DEFAULT 2,
    "no_show_interval_hours" INTEGER NOT NULL DEFAULT 48,
    "no_show_template" TEXT NOT NULL,
    "recall_enabled" BOOLEAN NOT NULL DEFAULT true,
    "recall_after_days" INTEGER NOT NULL DEFAULT 30,
    "recall_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recall_template" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_message" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "kind" "automation_kind" NOT NULL,
    "status" "outbound_status" NOT NULL DEFAULT 'pendente',
    "reason" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "body" TEXT NOT NULL,
    "phone" TEXT,
    "error" TEXT,
    "lead_id" UUID,
    "conversation_id" UUID,
    "appointment_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_opt_out" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_opt_out_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "holiday_scope" NOT NULL DEFAULT 'local',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_integration_clinic_id_provider_key" ON "clinic_integration"("clinic_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "automation_settings_clinic_id_key" ON "automation_settings"("clinic_id");

-- CreateIndex
CREATE INDEX "outbound_message_status_scheduled_for_idx" ON "outbound_message"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "outbound_message_clinic_id_created_at_idx" ON "outbound_message"("clinic_id", "created_at");

-- CreateIndex
CREATE INDEX "outbound_message_appointment_id_idx" ON "outbound_message"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_message_clinic_id_dedupe_key_key" ON "outbound_message"("clinic_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "contact_opt_out_clinic_id_idx" ON "contact_opt_out"("clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_opt_out_clinic_id_phone_key" ON "contact_opt_out"("clinic_id", "phone");

-- CreateIndex
CREATE INDEX "holiday_clinic_id_date_idx" ON "holiday"("clinic_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_clinic_id_date_key" ON "holiday"("clinic_id", "date");

-- CreateIndex
CREATE INDEX "lead_clinic_id_phone_idx" ON "lead"("clinic_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "lead_clinic_id_external_id_key" ON "lead"("clinic_id", "external_id");

-- CreateIndex
CREATE INDEX "appointment_clinic_id_starts_at_idx" ON "appointment"("clinic_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointment_clinic_id_status_starts_at_idx" ON "appointment"("clinic_id", "status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_clinic_id_external_id_key" ON "appointment"("clinic_id", "external_id");

-- AddForeignKey
ALTER TABLE "clinic_integration" ADD CONSTRAINT "clinic_integration_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_opt_out" ADD CONSTRAINT "contact_opt_out_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

