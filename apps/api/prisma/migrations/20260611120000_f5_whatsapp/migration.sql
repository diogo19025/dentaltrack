-- WA-1: mapeamento clínica↔instância Evolution + identidade do contato no canal sem login.

-- AlterTable: instância Evolution por clínica (resolve instância → clínica no webhook).
ALTER TABLE "clinic_settings" ADD COLUMN "whatsapp_instance" TEXT;

-- AlterTable: telefone/JID do contato (WhatsApp). NULL no web.
ALTER TABLE "conversation" ADD COLUMN "contact_phone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "clinic_settings_whatsapp_instance_key" ON "clinic_settings"("whatsapp_instance");

-- CreateIndex: lookup de conversa por (clínica, canal, telefone).
CREATE INDEX "conversation_clinic_id_channel_contact_phone_idx" ON "conversation"("clinic_id", "channel", "contact_phone");
