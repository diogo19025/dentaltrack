import { z } from "zod";
import { messageRoleSchema } from "./enums";

/**
 * Contrato do endpoint POST /chat (ver plan.md BE-1.6).
 * Versão mockada da F1: sem IA/streaming/tools — valida fluxo e persistência.
 */
export const chatRequestSchema = z.object({
  /** Conversa existente. Ausente → cria uma nova. */
  conversationId: z.string().uuid().optional(),
  /** Mensagem do paciente. */
  message: z.string().trim().min(1, "Mensagem não pode ser vazia.").max(4000),
  /**
   * Clínica-alvo (temporário enquanto /chat é público para testes).
   * Quando o guard de auth/tenant entrar (BE-1.6), o clinicId vem do JWT.
   */
  clinicId: z.string().uuid().optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Mensagem retornada ao cliente (espelha uma linha de `message`). */
export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;

/** Resposta do POST /chat. */
export const chatResponseSchema = z.object({
  conversationId: z.string().uuid(),
  assistantMessage: chatMessageSchema,
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;
