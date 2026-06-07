-- F2 (BE-2.1): oferta vigente + disponibilidade na configuração do bot.
-- AlterTable
ALTER TABLE "clinic_settings" ADD COLUMN     "offer_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offer_text" TEXT,
ADD COLUMN     "offer_starts_on" TEXT,
ADD COLUMN     "offer_ends_on" TEXT,
ADD COLUMN     "availability" JSONB;
