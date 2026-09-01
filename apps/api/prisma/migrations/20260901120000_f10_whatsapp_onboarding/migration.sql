-- F10: pareamento do WhatsApp por QR code na propria tela.
--
-- Guarda quando o dono respondeu a pergunta do 1o acesso ("ja tem um numero
-- dedicado?"), conectando ou dizendo que ainda nao tem. NULL = ainda nao
-- perguntamos. Sem isso, quem respondeu "ainda nao" seria perguntado de novo a
-- cada login.

-- AlterTable
ALTER TABLE "clinic_settings" ADD COLUMN     "whatsapp_onboarding_answered_at" TIMESTAMP(3);
