-- CreateTable
CREATE TABLE "clinic_settings" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "specialty" TEXT,
    "description" TEXT,
    "assistant_name" TEXT,
    "tone" TEXT,
    "greeting" TEXT,
    "instructions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_settings_clinic_id_key" ON "clinic_settings"("clinic_id");

-- AddForeignKey
ALTER TABLE "clinic_settings" ADD CONSTRAINT "clinic_settings_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

