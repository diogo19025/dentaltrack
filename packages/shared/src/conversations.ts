import { z } from "zod";
import { chatMessageSchema } from "./chat";
import { channelSchema, conversationStatusSchema } from "./enums";
import { tagColorSchema } from "./tags";

/**
 * Contrato de conversas (F3). `GET /conversations` alimenta a tabela "Conversas
 * recentes" do dashboard; `GET /conversations/:id` alimenta o rail de tags do
 * chat (tags detectadas pelo auto-tagging). Escopado por clínica.
 */

/** Tag detectada numa conversa, com a confiança do auto-tagging (0..1). */
export const detectedTagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: tagColorSchema,
  confidence: z.number(),
});
export type DetectedTag = z.infer<typeof detectedTagSchema>;

/** Item da tabela "Conversas recentes". */
export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  leadName: z.string().nullable(),
  procedure: z.string().nullable(),
  tags: z.array(z.object({ name: z.string(), color: tagColorSchema })),
  status: conversationStatusSchema,
  /** ISO 8601 (ou null se a conversa não tem mensagens). */
  lastMessageAt: z.string().nullable(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/**
 * Detalhe de uma conversa. Alimenta o rail de tags do chat (tags ao vivo) e o
 * painel "ver mais" das Conversas recentes do dashboard (histórico de mensagens).
 */
export const conversationDetailSchema = z.object({
  id: z.string().uuid(),
  status: conversationStatusSchema,
  channel: channelSchema,
  createdAt: z.string(),
  messageCount: z.number(),
  /** Telefone do contato (WhatsApp = número do paciente; web = telefone do lead, se houver). */
  contactPhone: z.string().nullable(),
  tags: z.array(detectedTagSchema),
  /**
   * Últimas idas e voltas (ordem cronológica) — paciente × bot, limitadas no
   * servidor. `messageCount` mantém o total para sinalizar truncamento.
   */
  messages: z.array(chatMessageSchema),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
