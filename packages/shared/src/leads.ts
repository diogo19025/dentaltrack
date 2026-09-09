import { z } from "zod";
import { channelSchema, conversationStatusSchema } from "./enums";
import { tagColorSchema } from "./tags";

/**
 * Contrato dos leads capturados (F3 · GET /leads ‖ FE-3.6). Escopado por
 * empresa (o `clinicId` vem do TenantGuard). Cada lead deriva interesse, tags e
 * status da(s) sua(s) conversa(s). Ver docs/produto.md § Modelo de dados.
 */

/** Pílula de tag (nome + cor fixa do design). */
export const leadTagSchema = z.object({
  name: z.string(),
  color: tagColorSchema,
});
export type LeadTag = z.infer<typeof leadTagSchema>;

/**
 * Temperatura do lead — chance de conversão derivada do comportamento na
 * conversa (agendamento, engajamento, tags, recência, abandono). Calculada
 * on-read pelo backend (`leads/lead-scoring.ts`), sem persistência.
 */
export const LEAD_TEMPERATURES = ["quente", "medio", "fraco"] as const;
export const leadTemperatureSchema = z.enum(LEAD_TEMPERATURES);
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

/** Contagem de leads por temperatura (seção do dashboard). */
export const leadTemperatureSummarySchema = z.object({
  quente: z.number(),
  medio: z.number(),
  fraco: z.number(),
});
export type LeadTemperatureSummary = z.infer<typeof leadTemperatureSummarySchema>;

/** Um lead na listagem. `status` = status da conversa mais recente do lead. */
export const leadSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** Procedimento de interesse (derivado do último agendamento/tag). */
  interest: z.string().nullable(),
  tags: z.array(leadTagSchema),
  status: conversationStatusSchema.nullable(),
  source: z.string(),
  /** ISO 8601. */
  createdAt: z.string(),
  /** Score de conversão 0–100 (inteiro), base da temperatura. */
  score: z.number(),
  temperature: leadTemperatureSchema,
});
export type LeadDto = z.infer<typeof leadSchema>;

/** Contagens dos 4 cards-resumo da tela de leads. */
export const leadsSummarySchema = z.object({
  total: z.number(),
  agendada: z.number(),
  andamento: z.number(),
  abandonada: z.number(),
});
export type LeadsSummary = z.infer<typeof leadsSummarySchema>;

/** Resposta de GET /leads. */
export const leadsResponseSchema = z.object({
  leads: z.array(leadSchema),
  summary: leadsSummarySchema,
  temperatures: leadTemperatureSummarySchema,
});
export type LeadsResponse = z.infer<typeof leadsResponseSchema>;

/**
 * Conversa de um lead no detalhe (GET /leads/:id). Carrega o `id` e o
 * `channel` — referência para abrir a conversa direto no canal quando o
 * adaptador WhatsApp existir (pós-MVP).
 */
export const leadConversationSchema = z.object({
  id: z.string().uuid(),
  channel: channelSchema,
  status: conversationStatusSchema,
  messageCount: z.number(),
  /** ISO 8601 (null se a conversa não tem mensagens). */
  lastMessageAt: z.string().nullable(),
  /** ISO 8601. */
  createdAt: z.string(),
  tags: z.array(leadTagSchema),
});
export type LeadConversation = z.infer<typeof leadConversationSchema>;

/** Pedido de agendamento do lead (evento de conversão). */
export const leadAppointmentSchema = z.object({
  id: z.string().uuid(),
  procedure: z.string().nullable(),
  preferredTime: z.string().nullable(),
  /** ISO 8601. */
  createdAt: z.string(),
});
export type LeadAppointment = z.infer<typeof leadAppointmentSchema>;

/** Resposta de GET /leads/:id — lead expandido com conversas e agendamentos. */
export const leadDetailSchema = leadSchema.extend({
  conversations: z.array(leadConversationSchema),
  appointments: z.array(leadAppointmentSchema),
});
export type LeadDetail = z.infer<typeof leadDetailSchema>;

/**
 * Exportação/importação de leads (F8). Export: GET /leads/export?format=…
 * (arquivo binário, Content-Disposition). Import: POST /leads/import
 * (multipart, planilha .xlsx ou .csv) → resultado abaixo.
 */
export const LEAD_EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export const leadExportFormatSchema = z.enum(LEAD_EXPORT_FORMATS);
export type LeadExportFormat = (typeof LEAD_EXPORT_FORMATS)[number];

/** Erro de uma linha rejeitada na importação (1-based, contando o cabeçalho). */
export const leadImportErrorSchema = z.object({
  line: z.number(),
  reason: z.string(),
});
export type LeadImportError = z.infer<typeof leadImportErrorSchema>;

/** Resposta de POST /leads/import. */
export const leadImportResultSchema = z.object({
  /** Linhas de dados encontradas na planilha. */
  total: z.number(),
  /** Leads criados. */
  imported: z.number(),
  /** Linhas puladas por já existirem (mesmo telefone ou e-mail na clínica/arquivo). */
  duplicates: z.number(),
  /** Linhas puladas por dados inválidos (sem contato, e-mail malformado…). */
  invalid: z.number(),
  /** Detalhe das primeiras linhas rejeitadas (máx. 20). */
  errors: z.array(leadImportErrorSchema),
});
export type LeadImportResult = z.infer<typeof leadImportResultSchema>;
