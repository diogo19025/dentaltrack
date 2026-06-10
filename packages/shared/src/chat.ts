import { z } from "zod";
import { messageRoleSchema } from "./enums";

/**
 * Contrato do endpoint POST /chat (BE-1.6, streaming).
 * O `clinicId` NÃO vem no body: é resolvido pelo TenantGuard a partir do JWT.
 * A resposta é um UI message stream do AI SDK (consumível pelo `useChat`);
 * o `conversationId` volta no header `X-Conversation-Id`.
 */
export const chatRequestSchema = z.object({
  /** Conversa existente. Ausente → cria uma nova. */
  conversationId: z.string().uuid().optional(),
  /** Mensagem do paciente. */
  message: z.string().trim().min(1, "Mensagem não pode ser vazia.").max(4000),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/**
 * Resposta de POST /chat/transcribe (speech-to-text). O áudio sobe como
 * multipart/form-data no campo `audio`; a API devolve o texto transcrito,
 * que segue o fluxo normal do chat como mensagem do paciente.
 */
export const transcriptionResponseSchema = z.object({
  /** Texto transcrito do áudio do paciente (PT-BR). */
  text: z.string(),
});
export type TranscriptionResponse = z.infer<typeof transcriptionResponseSchema>;

/** Mensagem de chat (espelha uma linha de `message`). */
export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;
