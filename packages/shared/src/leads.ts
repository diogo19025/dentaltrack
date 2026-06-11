import { z } from "zod";
import { conversationStatusSchema } from "./enums";
import { tagColorSchema } from "./tags";

/**
 * Contrato dos leads capturados (F3 · GET /leads ‖ FE-3.6). Escopado por
 * clínica (o `clinicId` vem do TenantGuard). Cada lead deriva interesse, tags e
 * status da(s) sua(s) conversa(s). Ver docs/plan.md §5/§6.
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
