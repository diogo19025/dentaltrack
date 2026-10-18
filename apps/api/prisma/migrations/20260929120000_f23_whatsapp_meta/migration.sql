-- Cloud API oficial da Meta como provedor alternativo de WhatsApp (aditiva).
ALTER TABLE "clinic_settings" ADD COLUMN "whatsapp_provider" TEXT NOT NULL DEFAULT 'evolution';
ALTER TABLE "clinic_settings" ADD COLUMN "meta_phone_number_id" TEXT;
ALTER TABLE "clinic_settings" ADD COLUMN "meta_waba_id" TEXT;
ALTER TABLE "clinic_settings" ADD COLUMN "meta_access_token_enc" TEXT;
ALTER TABLE "clinic_settings" ADD COLUMN "meta_display_phone" TEXT;
ALTER TABLE "clinic_settings" ADD COLUMN "meta_verified_name" TEXT;
CREATE UNIQUE INDEX "clinic_settings_meta_phone_number_id_key" ON "clinic_settings"("meta_phone_number_id");
