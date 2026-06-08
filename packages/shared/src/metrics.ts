import { z } from "zod";
import { conversationStatusSchema } from "./enums";
import { tagColorSchema } from "./tags";

/**
 * Contrato das métricas do dashboard (F3 · BE-3.2/3.3 ‖ FE-3.1..3.5).
 * Definições em docs/context.md §10. Escopado por clínica (o `clinicId` vem do
 * TenantGuard). Taxas vêm como fração 0..1 (o FE formata como %).
 */

/** Janela de período do dashboard (default 50d — requisito do produto). */
export const METRICS_RANGES = ["7d", "30d", "50d", "90d"] as const;
export const metricsRangeSchema = z.enum(METRICS_RANGES);
export type MetricsRange = (typeof METRICS_RANGES)[number];

/** Dias correspondentes a cada janela. */
export const RANGE_DAYS: Record<MetricsRange, number> = {
  "7d": 7,
  "30d": 30,
  "50d": 50,
  "90d": 90,
};

/** Um KPI: valor + variação (delta %) vs. janela anterior + mini-série. */
export const kpiSchema = z.object({
  /** Valor bruto: contagem (inteiro) ou taxa (0..1). */
  value: z.number(),
  /** Variação % vs. janela anterior (arredondada); null quando não há base. */
  delta: z.number().nullable(),
  deltaDir: z.enum(["up", "down"]).nullable(),
  /** Série curta para o sparkline (pode ser vazia nos cards sem gráfico). */
  spark: z.array(z.number()),
});
export type Kpi = z.infer<typeof kpiSchema>;

/** Os 6 KPIs do dashboard (ordem do mock). */
export const metricsKpisSchema = z.object({
  leads: kpiSchema,
  botMessages: kpiSchema,
  responseRate: kpiSchema,
  conversionRate: kpiSchema,
  inProgress: kpiSchema,
  notCompleted: kpiSchema,
});
export type MetricsKpis = z.infer<typeof metricsKpisSchema>;

/** Série de linha: mensagens por dia, bot × paciente. */
export const lineSeriesSchema = z.object({
  labels: z.array(z.string()),
  bot: z.array(z.number()),
  patient: z.array(z.number()),
});
export type LineSeries = z.infer<typeof lineSeriesSchema>;

/** Funil de conversão (iniciadas → engajadas → agendadas). */
export const funnelSchema = z.object({
  started: z.number(),
  engaged: z.number(),
  scheduled: z.number(),
});
export type Funnel = z.infer<typeof funnelSchema>;

/** Uma fatia do ranking de tags (top tags). */
export const topTagSchema = z.object({
  name: z.string(),
  color: tagColorSchema,
  value: z.number(),
});
export type TopTag = z.infer<typeof topTagSchema>;

/** Uma fatia da distribuição de status (donut). */
export const statusSliceSchema = z.object({
  status: conversationStatusSchema,
  value: z.number(),
});
export type StatusSlice = z.infer<typeof statusSliceSchema>;

/** Resposta de GET /metrics?range=. */
export const metricsSchema = z.object({
  range: metricsRangeSchema,
  kpis: metricsKpisSchema,
  line: lineSeriesSchema,
  funnel: funnelSchema,
  topTags: z.array(topTagSchema),
  statusDistribution: z.array(statusSliceSchema),
});
export type MetricsDto = z.infer<typeof metricsSchema>;
