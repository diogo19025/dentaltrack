-- Segundo número de WhatsApp, só para avisos e automações (aditiva).
ALTER TABLE "clinic_settings" ADD COLUMN "whatsapp_alerts_instance" TEXT;
CREATE UNIQUE INDEX "clinic_settings_whatsapp_alerts_instance_key" ON "clinic_settings"("whatsapp_alerts_instance");
