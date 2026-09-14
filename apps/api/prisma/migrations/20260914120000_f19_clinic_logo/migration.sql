-- F13 (upload de imagem): logo da empresa.
--
-- A tela de Configurações sempre teve o espaço da logo — veio do handoff de
-- design — mas não havia onde guardar o resultado. A coluna nasce nula e é
-- preenchida pelo PATCH /settings depois do upload.
--
-- Aditiva e compatível com a versão anterior da API.
ALTER TABLE "clinic_settings"
ADD COLUMN IF NOT EXISTS "logo_url" TEXT;
