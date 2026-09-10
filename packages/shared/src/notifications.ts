import { z } from "zod";

/**
 * Central de notificações (sino do topbar) — o que aconteceu na operação
 * enquanto o dono não estava olhando.
 *
 * Nenhuma tabela nova de eventos: as notificações são **derivadas** dos
 * registros que o produto já grava (conversas, leads, agendamentos, fila de
 * automações). Isso mantém a fonte de verdade única — se um dia a lista quiser
 * mais tipos, é uma query a mais, não um backfill.
 *
 * "Não lida" = evento posterior a `clinic_settings.notifications_seen_at`
 * (por empresa — o MVP é um dono por clínica). Abrir o painel marca tudo como
 * visto, como nos CRMs de referência (HubSpot/Pipedrive): o sino é um resumo,
 * não uma caixa de tarefas.
 */

/**
 * Tipos de notificação:
 * - `conversa_iniciada` — paciente novo começou a falar (web ou WhatsApp);
 * - `lead_capturado` — o assistente capturou o contato (exclui importação em
 *   massa, que inundaria o sino);
 * - `agendamento_criado` — pedido/horário marcado por bot, integração ou à mão;
 * - `conversa_abandonada` — o paciente sumiu no meio (cron de abandono);
 * - `automacao_falhou` — mensagem automática que NÃO saiu (lembrete, retomada) —
 *   é o tipo mais acionável: sem ele a falha é invisível até o paciente faltar.
 * - `whatsapp_desconectado` — a sessão da empresa caiu e precisa de ação.
 */
export const NOTIFICATION_TYPES = [
  "conversa_iniciada",
  "lead_capturado",
  "agendamento_criado",
  "conversa_abandonada",
  "automacao_falhou",
  "whatsapp_desconectado",
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Um item do painel. `id` é estável (`tipo:entidade`) p/ dedupe no cliente. */
export const notificationItemSchema = z.object({
  id: z.string(),
  type: notificationTypeSchema,
  /** Manchete curta ("Nova conversa pelo WhatsApp"). */
  title: z.string(),
  /** Contexto: nome/telefone do contato, horário do agendamento, motivo da falha. */
  description: z.string().nullable(),
  /** Quando o evento aconteceu (ISO). Ordena o painel, decide o "não lida". */
  occurredAt: z.string(),
  /** Evento posterior ao último "visto" da empresa. */
  unread: z.boolean(),
  /** Canal de origem quando faz diferença na manchete (conversas). */
  channel: z.enum(["web", "whatsapp"]).nullable(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

/** GET /notifications — itens recentes (janela de 7 dias, mais novos primeiro). */
export const notificationsDtoSchema = z.object({
  items: z.array(notificationItemSchema),
  /** Total de não lidas (o badge do sino; a UI exibe "9+" acima de 9). */
  unreadCount: z.number().int().min(0),
  /** Último "marcar como visto" da empresa (ISO) — null = nunca abriu o sino. */
  seenAt: z.string().nullable(),
});
export type NotificationsDto = z.infer<typeof notificationsDtoSchema>;

/** POST /notifications/seen — zera o contador; devolve o novo marco. */
export const notificationsSeenResultSchema = z.object({
  seenAt: z.string(),
});
export type NotificationsSeenResult = z.infer<
  typeof notificationsSeenResultSchema
>;
