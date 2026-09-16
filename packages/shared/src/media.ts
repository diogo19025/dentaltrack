import { z } from "zod";

/**
 * Mídia de saída do agente (F6 — saudação/oferta com imagem, vídeo, áudio ou
 * catálogo). Compartilhado entre a API (que resolve a mídia e a envia pelo
 * canal) e o front (configuração + preview).
 *
 * A mídia sempre é **referenciada por URL pública** — é o que a Evolution
 * precisa para enviar pelo WhatsApp. O que mudou na F13 é de onde essa URL
 * pode vir: até 2026-09-14 só existia colar uma URL de terceiros, o que exigia
 * do dono da empresa hospedar a imagem em algum lugar antes. Agora ele pode
 * enviar o arquivo (`POST /media/upload`) e a URL vem do nosso storage.
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

/**
 * ─── Envio de arquivo (F13) ───────────────────────────────────────────────
 *
 * Até 2026-09-14 a mídia só podia ser **referenciada**: o dono tinha que
 * hospedar a imagem em algum lugar e colar a URL. Na prática isso significa
 * que a funcionalidade não existia para quem não tem onde hospedar — que é
 * justamente o perfil do cliente deste produto. `POST /media/upload` recebe o
 * arquivo e devolve a URL pública; o campo de URL continua existindo, porque
 * quem já tem a imagem publicada não deveria ser obrigado a subir de novo.
 */

/** Onde o arquivo vai ser usado — decide limite de tamanho e formatos aceitos. */
export const MEDIA_PURPOSES = ["logo", "oferta"] as const;
export const mediaPurposeSchema = z.enum(MEDIA_PURPOSES);
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

/**
 * MIME aceito → tipo de mídia do domínio.
 *
 * É a lista de formatos aceitos **e** o que permite a tela preencher o campo
 * "Tipo" sozinha: quem sobe um `.jpg` não deveria precisar dizer que é imagem.
 * Os formatos são os que a Evolution entrega no WhatsApp — aceitar um `.tiff`
 * aqui só adiantaria a falha para o momento do envio, longe da tela.
 */
export const MEDIA_MIME_TO_TYPE: Readonly<Record<string, MediaType>> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/3gpp": "video",
  "video/quicktime": "video",
  "audio/ogg": "audio",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/aac": "audio",
  "application/pdf": "document",
};

/**
 * Formatos da logo. **SVG fica de fora de propósito**, apesar de o design
 * pedir: SVG é XML que pode conter `<script>`, e o arquivo é servido de um
 * domínio público. Dentro de um `<img>` o script não roda, mas basta alguém
 * abrir a URL direto para rodar. Trocar esse risco por um formato vetorial não
 * se justifica num logo que aparece em 76px.
 */
export const LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** Teto por finalidade. O da oferta acompanha o que o WhatsApp entrega bem. */
export const MEDIA_MAX_BYTES: Readonly<Record<MediaPurpose, number>> = {
  logo: 1 * 1024 * 1024,
  oferta: 16 * 1024 * 1024,
};

/** Extensão a partir do MIME — o nome original do arquivo não é confiável. */
export const MEDIA_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "application/pdf": "pdf",
};

/** Resposta de `POST /media/upload`. */
export const mediaUploadResultSchema = z.object({
  /** URL pública, pronta para ir no campo de mídia e para a Evolution enviar. */
  url: z.string().url(),
  /** Tipo inferido do MIME — a tela usa para preencher o select de "Tipo". */
  type: mediaTypeSchema,
  fileName: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type MediaUploadResult = z.infer<typeof mediaUploadResultSchema>;

/** Rótulo curto dos formatos aceitos, para a dica embaixo do campo. */
export function acceptedFormatsLabel(purpose: MediaPurpose): string {
  return purpose === "logo"
    ? "PNG, JPG ou WEBP até 1 MB"
    : "Imagem, vídeo, áudio ou PDF até 16 MB";
}

/** `accept` do `<input type="file">` correspondente à finalidade. */
export function acceptAttribute(purpose: MediaPurpose): string {
  return purpose === "logo"
    ? LOGO_MIME_TYPES.join(",")
    : Object.keys(MEDIA_MIME_TO_TYPE).join(",");
}
