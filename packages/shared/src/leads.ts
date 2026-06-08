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
});
export type LeadsResponse = z.infer<typeof leadsResponseSchema>;
