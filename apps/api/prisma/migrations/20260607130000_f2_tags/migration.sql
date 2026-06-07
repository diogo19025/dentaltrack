-- F2 (BE-2.3): tags configuráveis pela clínica (keywords = gatilhos do auto-tagging na F3).
-- CreateEnum
CREATE TYPE "tag_color" AS ENUM ('teal', 'violet', 'amber', 'blue', 'rose', 'sage');

-- CreateTable
CREATE TABLE "tag" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" "tag_color" NOT NULL DEFAULT 'teal',
    "category" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tag_clinic_id_idx" ON "tag"("clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_clinic_id_name_key" ON "tag"("clinic_id", "name");

-- AddForeignKey
ALTER TABLE "tag" ADD CONSTRAINT "tag_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
