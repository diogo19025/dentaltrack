-- F3 (BE-3.1 / BE-3.4): aplicação de tags por conversa (auto-tagging) + pré-agregação diária.

-- CreateTable
CREATE TABLE "conversation_tag" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_metric" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "bot_messages" INTEGER NOT NULL DEFAULT 0,
    "user_messages" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "conversations_started" INTEGER NOT NULL DEFAULT 0,
    "conversations_scheduled" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_metric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_tag_clinic_id_idx" ON "conversation_tag"("clinic_id");

-- CreateIndex
CREATE INDEX "conversation_tag_tag_id_idx" ON "conversation_tag"("tag_id");

-- CreateIndex
CREATE INDEX "conversation_tag_conversation_id_idx" ON "conversation_tag"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_tag_conversation_id_tag_id_key" ON "conversation_tag"("conversation_id", "tag_id");

-- CreateIndex
CREATE INDEX "daily_metric_clinic_id_idx" ON "daily_metric"("clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metric_clinic_id_date_key" ON "daily_metric"("clinic_id", "date");

-- AddForeignKey
ALTER TABLE "conversation_tag" ADD CONSTRAINT "conversation_tag_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_tag" ADD CONSTRAINT "conversation_tag_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_tag" ADD CONSTRAINT "conversation_tag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metric" ADD CONSTRAINT "daily_metric_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
