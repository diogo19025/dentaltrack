import { z } from "zod";
import { messageRoleSchema } from "./enums";

/** Limite do áudio em base64 (~10 MB de binário). */
const MAX_AUDIO_BASE64 = 14_000_000;

/**
 * Contrato do endpoint POST /chat (BE-1.6, streaming).
 * O `clinicId` NÃO vem no body: é resolvido pelo TenantGuard a partir do JWT.
 * A entrada do paciente é texto (`message`) OU áudio (`audio` + `audioType`) —
 * exatamente um dos dois. O áudio é transcrito no servidor (speech-to-text) e a
 * transcrição segue o fluxo normal do turno (persistência, tools, tagging),
 * voltando ao cliente no header `X-Transcript` (URI-encoded).
 * A resposta é um UI message stream do AI SDK (consumível pelo `useChat`);
 * o `conversationId` volta no header `X-Conversation-Id`.
 */
export const chatRequestSchema = z
  .object({
    /** Conversa existente. Ausente → cria uma nova. */
    conversationId: z.string().uuid().optional(),
    /** Mensagem de texto do paciente (exclusivo com `audio`). */
    message: z
      .string()
      .trim()
      .min(1, "Mensagem não pode ser vazia.")
      .max(4000)
      .optional(),
    /** Áudio do paciente em base64, sem o prefixo `data:` (exclusivo com `message`). */
    audio: z.string().min(1).max(MAX_AUDIO_BASE64).optional(),
    /** MIME do áudio (ex.: `audio/webm`) — obrigatório junto com `audio`. */
    audioType: z
      .string()
      .max(120)
      .regex(/^(audio\/|video\/webm)/, "audioType deve ser um MIME de áudio.")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.message && !data.audio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Envie `message` (texto) ou `audio` (base64).",
      });
    }
    if (data.message && data.audio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Envie apenas um: `message` ou `audio`.",
      });
    }
    if (data.audio && !data.audioType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audioType"],
        message: "audioType é obrigatório quando `audio` é enviado.",
      });
    }
  });
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Mensagem de chat (espelha uma linha de `message`). */
export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;
