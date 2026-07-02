import { z } from "zod";

/**
 * Mídia de saída do agente (F6 — saudação/oferta com imagem, vídeo, áudio ou
 * catálogo). Compartilhado entre a API (que resolve a mídia e a envia pelo
 * canal) e o front (configuração + preview). No MVP a mídia é referenciada por
 * **URL pública** — sem storage próprio; a Evolution envia a partir da URL.
 */

/**
 * Tipos de mídia suportados. `document` cobre o "catálogo" (PDF/imagem única
 * enviada como documento). `audio` é enviado como mensagem de voz (PTT) no
 * WhatsApp.
 */
export const MEDIA_TYPES = ["image", "video", "audio", "document"] as const;
export const mediaTypeSchema = z.enum(MEDIA_TYPES);
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Rótulos em PT-BR dos tipos de mídia (para selects na UI). */
export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Catálogo / documento",
};

/**
 * Um anexo que o agente decide enviar num turno (saudação ou oferta). O canal
 * (WhatsApp) envia; o web hoje ignora (mantém texto). `caption` só se aplica a
 * imagem/vídeo/documento.
 */
export const mediaAttachmentSchema = z.object({
  url: z.string().trim().url("Informe uma URL válida.").max(2000),
  type: mediaTypeSchema,
  caption: z.string().trim().max(1000).optional(),
});
export type MediaAttachment = z.infer<typeof mediaAttachmentSchema>;

/**
 * Valida uma URL de mídia vinda de formulário: aceita vazio (campo opcional) e,
 * quando preenchido, exige URL http(s). Uso nos schemas de settings/procedures.
 */
export const mediaUrlFieldSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), {
    message: "Informe uma URL http(s) válida (ou deixe em branco).",
  });
