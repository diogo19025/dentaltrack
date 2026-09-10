import { z } from "zod";
import { chatMessageSchema } from "./chat";
import { channelSchema, conversationStatusSchema } from "./enums";
import { tagColorSchema } from "./tags";

/**
 * Contrato de conversas (F3). `GET /conversations` alimenta a tabela "Conversas
 * recentes" do dashboard; `GET /conversations/:id` alimenta o rail de tags do
 * chat (tags detectadas pelo auto-tagging). Escopado por empresa.
 */

/** Tag detectada numa conversa, com a confiança do auto-tagging (0..1). */
export const detectedTagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: tagColorSchema,
  confidence: z.number(),
});
export type DetectedTag = z.infer<typeof detectedTagSchema>;

/**
 * **Handoff humano** (P0.2) — desde quando um atendente assumiu a conversa.
 * `null` significa que a IA responde, que é o estado normal.
 *
 * É deliberadamente **ortogonal ao `status`**, e não um `ConversationStatus`
 * novo: uma conversa `agendada` (terminal na máquina de estados) também pode
 * precisar de gente, e acrescentar um estado quebraria as métricas, o funil e
 * o dashboard, que contam por status.
 */
const handoffAtSchema = z.string().nullable();

/** Item da tabela "Conversas recentes". */
export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  leadName: z.string().nullable(),
  procedure: z.string().nullable(),
  tags: z.array(z.object({ name: z.string(), color: tagColorSchema })),
  status: conversationStatusSchema,
  /** ISO 8601 (ou null se a conversa não tem mensagens). */
  lastMessageAt: z.string().nullable(),
  /** ISO 8601 desde quando um atendente assumiu; `null` = a IA responde. */
  handoffAt: handoffAtSchema.default(null),
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
  /** Telefone do contato (WhatsApp = número do cliente; web = telefone do lead, se houver). */
  contactPhone: z.string().nullable(),
  /** ISO 8601 desde quando um atendente assumiu; `null` = a IA responde. */
  handoffAt: handoffAtSchema.default(null),
  /** Por que a conversa foi assumida (opcional, escrito por quem assumiu). */
  handoffReason: z.string().nullable().default(null),
  tags: z.array(detectedTagSchema),
  /**
   * Últimas idas e voltas (ordem cronológica) — cliente × bot, limitadas no
   * servidor. `messageCount` mantém o total para sinalizar truncamento.
   */
  messages: z.array(chatMessageSchema),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

/**
 * Corpo de `POST /conversations/:id/handoff` — assumir o atendimento.
 *
 * O motivo é opcional de propósito: exigir justificativa para tirar o robô da
 * frente de um cliente irritado é atrito no pior momento possível.
 */
export const startHandoffSchema = z.object({
  reason: z.string().trim().max(280).optional(),
});
export type StartHandoffInput = z.infer<typeof startHandoffSchema>;

/** Resposta dos dois endpoints de handoff — o estado como ficou. */
export const handoffStateSchema = z.object({
  conversationId: z.string().uuid(),
  handoffAt: handoffAtSchema,
  handoffReason: z.string().nullable(),
});
export type HandoffState = z.infer<typeof handoffStateSchema>;
