-- F7: Funil de atendimento (kanban) — colunas por clínica + card por contato.

-- CreateEnum
CREATE TYPE "funnel_stage" AS ENUM ('novo_contato', 'interessado', 'quero_agendar', 'escolha_data', 'agendado');

-- CreateEnum
CREATE TYPE "pipeline_source" AS ENUM ('auto', 'manual');

-- CreateTable
CREATE TABLE "pipeline_stage" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "system_stage" "funnel_stage",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_card" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "conversation_id" UUID,
    "lead_id" UUID,
    "stage_id" UUID NOT NULL,
    "source" "pipeline_source" NOT NULL DEFAULT 'auto',
    "stage_source" "pipeline_source" NOT NULL DEFAULT 'auto',
    "note" TEXT,
    "stage_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stage_clinic_id_system_stage_key" ON "pipeline_stage"("clinic_id", "system_stage");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stage_clinic_id_name_key" ON "pipeline_stage"("clinic_id", "name");

-- CreateIndex
CREATE INDEX "pipeline_stage_clinic_id_position_idx" ON "pipeline_stage"("clinic_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_card_conversation_id_key" ON "pipeline_card"("conversation_id");

-- CreateIndex
CREATE INDEX "pipeline_card_clinic_id_stage_id_idx" ON "pipeline_card"("clinic_id", "stage_id");

-- CreateIndex
CREATE INDEX "pipeline_card_clinic_id_idx" ON "pipeline_card"("clinic_id");

-- CreateIndex
CREATE INDEX "pipeline_card_lead_id_idx" ON "pipeline_card"("lead_id");

-- AddForeignKey
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_card" ADD CONSTRAINT "pipeline_card_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_card" ADD CONSTRAINT "pipeline_card_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_card" ADD CONSTRAINT "pipeline_card_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_card" ADD CONSTRAINT "pipeline_card_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
