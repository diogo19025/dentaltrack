import { z } from "zod";

/**
 * Agenda (F9) — contrato do agendamento com **data e hora reais**.
 *
 * Até a F8 o agendamento era só um *pedido* (`preferredTime` em texto livre:
 * "semana que vem de tarde"). Isso basta para medir conversão, mas não para
 * lembrete ("3 dias antes" de quê?), atraso ou falta. A F9 introduz o horário
 * real (`startsAt`) e um **status normalizado**, alimentados pelo agente (com
 * disponibilidade confirmada) ou pela integração com o sistema da empresa.
 *
 * Multi-tenant: tudo escopado por `clinicId` (vem do TenantGuard, nunca do body).
 */

/**
 * Status do agendamento no **nosso** domínio. Os sistemas externos têm dezenas
 * de status próprios (e cada conta nomeia os seus), por isso nunca os usamos
 * direto: o operador mapeia `status externo → status daqui` na tela de
 * integração (ver `integrations.ts`). As automações leem só estes seis:
 * - `pedido` — pedido do agente sem horário confirmado (o mundo pré-F9);
 * - `agendado` — tem data/hora reais;
 * - `confirmado` — o cliente confirmou presença;
 * - `compareceu` — chegou/foi atendido (encerra lembretes, habilita o retorno);
 * - `faltou` — no-show (dispara a cadência de remarcação);
 * - `cancelado` — desmarcado (silencia toda automação).
 */
export const APPOINTMENT_STATUSES = [
  "pedido",
  "agendado",
  "confirmado",
  "compareceu",
  "faltou",
  "cancelado",
] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Rótulos em PT-BR para a UI (o enum é o contrato; isto é só exibição). */
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  pedido: "Pedido",
  agendado: "Agendado",
  confirmado: "Confirmado",
  compareceu: "Compareceu",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

/**
 * Status em que o agendamento ainda vai acontecer — o filtro das automações de
 * lembrete e de atraso. `pedido` fica de fora de propósito: sem horário real
 * não há o que lembrar.
 */
export const ACTIVE_APPOINTMENT_STATUSES = [
  "agendado",
  "confirmado",
] as const satisfies readonly AppointmentStatus[];

/** De onde veio o agendamento. */
export const APPOINTMENT_SOURCES = ["bot", "integracao", "manual"] as const;
export const appointmentSourceSchema = z.enum(APPOINTMENT_SOURCES);
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

/**
 * Um horário livre oferecível ao cliente. Vem da integração (agenda real) ou,
 * sem ela, da disponibilidade configurada em `/settings` — o agente não sabe a
 * diferença, o que mantém o motor channel- e provider-agnostic.
 *
 * `startsAt`/`endsAt` são ISO 8601 **com offset** (nunca "hora solta"): o
 * servidor pode rodar em UTC e a empresa em -03:00, e um lembrete de "1 hora
 * antes" errado por 3 horas é pior do que lembrete nenhum.
 */
export const availableSlotSchema = z.object({
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  /** Identificador do profissional no sistema de origem (opaco para nós). */
  professionalId: z.string().nullable(),
  professionalName: z.string().nullable(),
  /** Unidade/consultório, quando a empresa tem mais de um. */
  unitId: z.string().nullable(),
});
export type AvailableSlot = z.infer<typeof availableSlotSchema>;

/** Resposta da consulta de disponibilidade. */
export const availabilitySchema = z.object({
  slots: z.array(availableSlotSchema),
  /**
   * `true` quando os horários vieram da agenda real da empresa; `false` quando
   * são a disponibilidade declarada em `/settings` (aproximação). A UI e o
   * prompt do agente usam isto para calibrar o quanto prometem ao cliente.
   */
  live: z.boolean(),
});
export type Availability = z.infer<typeof availabilitySchema>;

/** Agendamento como a UI o consome. */
export const appointmentSummarySchema = z.object({
  id: z.string().uuid(),
  status: appointmentStatusSchema,
  source: appointmentSourceSchema,
  /** ISO 8601 com offset; `null` enquanto for só um `pedido`. */
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  /** Texto livre da preferência (mundo pré-F9 e fallback sem integração). */
  preferredTime: z.string().nullable(),
  procedureName: z.string().nullable(),
  professionalName: z.string().nullable(),
  leadId: z.string().uuid().nullable(),
  leadName: z.string().nullable(),
  leadPhone: z.string().nullable(),
  conversationId: z.string().uuid().nullable(),
  /** Id no sistema externo, quando sincronizado. */
  externalId: z.string().nullable(),
  /** Quando foi cancelado (P0.5); `null` enquanto estiver de pé. */
  canceledAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AppointmentSummary = z.infer<typeof appointmentSummarySchema>;

/**
 * Status a partir dos quais ainda faz sentido cancelar ou remarcar (P0.5).
 * `compareceu` é história; `cancelado` já está lá — e cancelar de novo é
 * no-op de sucesso no servidor, não erro.
 */
export const REVISABLE_APPOINTMENT_STATUSES = [
  "pedido",
  "agendado",
  "confirmado",
  "faltou",
] as const satisfies readonly AppointmentStatus[];

/**
 * Corpo de POST /agenda/:id/remarcar — o novo horário (ISO 8601 com offset).
 * Cancelar (POST /agenda/:id/cancelar) não tem corpo. Nenhum dos dois é dado
 * como tool ao agente: o bot cancelando consulta por mal-entendido é dano
 * irreversível.
 */
export const rescheduleAppointmentSchema = z.object({
  startsAt: z.string().min(1),
});
export type RescheduleAppointmentInput = z.infer<
  typeof rescheduleAppointmentSchema
>;

/** GET /agenda — janela de agendamentos da empresa. */
export const agendaQuerySchema = z.object({
  /** YYYY-MM-DD (inclusivo). Default: hoje. */
  from: z.string().optional(),
  /** YYYY-MM-DD (inclusivo). Default: `from` + 7 dias. */
  to: z.string().optional(),
  status: appointmentStatusSchema.optional(),
});
export type AgendaQuery = z.infer<typeof agendaQuerySchema>;

export const agendaResponseSchema = z.object({
  appointments: z.array(appointmentSummarySchema),
  /** Quando a agenda foi sincronizada com o sistema externo pela última vez. */
  lastSyncedAt: z.string().nullable(),
});
export type AgendaResponse = z.infer<typeof agendaResponseSchema>;
