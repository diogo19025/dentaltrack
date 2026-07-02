-- F6: mídia de saudação/oferta (imagem, vídeo, áudio, catálogo) + oferta por procedimento.

-- AlterTable: mídia da saudação e da oferta global na configuração da clínica.
ALTER TABLE "clinic_settings" ADD COLUMN "greeting_media_url" TEXT;
ALTER TABLE "clinic_settings" ADD COLUMN "greeting_media_type" TEXT;
ALTER TABLE "clinic_settings" ADD COLUMN "offer_media_url" TEXT;
ALTER TABLE "clinic_settings" ADD COLUMN "offer_media_type" TEXT;

-- AlterTable: oferta personalizada (texto + mídia) por procedimento.
ALTER TABLE "procedure" ADD COLUMN "offer_text" TEXT;
ALTER TABLE "procedure" ADD COLUMN "offer_media_url" TEXT;
ALTER TABLE "procedure" ADD COLUMN "offer_media_type" TEXT;
