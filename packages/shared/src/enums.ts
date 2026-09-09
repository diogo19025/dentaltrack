import { z } from "zod";

/**
 * Canais de atendimento. Os dois estão em produção e rodam o **mesmo** motor —
 * são adapters de borda, não implementações paralelas (docs/produto.md § Arquitetura).
 */
export const CHANNELS = ["web", "whatsapp"] as const;
export const channelSchema = z.enum(CHANNELS);
export type Channel = (typeof CHANNELS)[number];

/**
 * Status da conversa (domínio — ver docs/produto.md § Métricas).
 * `em_andamento` → `agendada` (conversão) | `abandonada` (inatividade).
 */
export const CONVERSATION_STATUSES = ["em_andamento", "agendada", "abandonada"] as const;
export const conversationStatusSchema = z.enum(CONVERSATION_STATUSES);
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Papel de cada mensagem persistida. */
export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export const messageRoleSchema = z.enum(MESSAGE_ROLES);
export type MessageRole = (typeof MESSAGE_ROLES)[number];
