import { z } from "zod";

/**
 * Contrato do **lembrete por WhatsApp** disparado pelo CRM (pós-MVP). É uma
 * mensagem proativa que o operador envia para reengajar um cliente sobre uma
 * conversa anterior — sai pelo mesmo adaptador Evolution do canal WhatsApp e é
 * persistida na própria conversa. Escopado por empresa (o `clinicId` vem do
 * TenantGuard, nunca do body). Endpoints sob `/conversations/:id/reminder`.
 */

/** Tamanho máximo do texto do lembrete (limite são e seguro para WhatsApp). */
export const REMINDER_MAX_LENGTH = 1000;

/** Corpo de POST /conversations/:id/reminder — o texto a enviar ao cliente. */
export const sendReminderSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Escreva a mensagem do lembrete.")
    .max(REMINDER_MAX_LENGTH, `Use no máximo ${REMINDER_MAX_LENGTH} caracteres.`),
});
export type SendReminderInput = z.infer<typeof sendReminderSchema>;

/**
 * Por que um lembrete não pode ser enviado (controla a UI da caixa de envio):
 * - `no_phone` — o contato não tem telefone capturado;
 * - `whatsapp_not_configured` — a empresa não conectou uma instância do WhatsApp.
 */
export const REMINDER_BLOCKERS = ["no_phone", "whatsapp_not_configured"] as const;
export const reminderBlockerSchema = z.enum(REMINDER_BLOCKERS);
export type ReminderBlocker = (typeof REMINDER_BLOCKERS)[number];

/**
 * Contexto da caixa "Enviar lembrete" (GET /conversations/:id/reminder): se dá
 * para enviar (e por que não), o telefone resolvido (só exibição) e um rascunho
 * determinístico já pré-preenchido a partir do nome/interesse do cliente.
 */
export const reminderContextSchema = z.object({
  canSend: z.boolean(),
  /** Preenchido só quando `canSend` é false — alimenta a mensagem de ajuda. */
  reason: reminderBlockerSchema.nullable(),
  /** Telefone do contato resolvido (contactPhone do canal ou telefone do lead). */
  phone: z.string().nullable(),
  /** Rascunho sugerido (template) para pré-preencher a caixa de texto. */
  draft: z.string(),
});
export type ReminderContext = z.infer<typeof reminderContextSchema>;

/** Resposta de POST /conversations/:id/reminder. */
export const sendReminderResultSchema = z.object({
  conversationId: z.string().uuid(),
  /** ISO 8601 do instante do envio. */
  sentAt: z.string(),
});
export type SendReminderResult = z.infer<typeof sendReminderResultSchema>;
