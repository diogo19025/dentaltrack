import { z } from "zod";
import { channelSchema, conversationStatusSchema } from "./enums";

/**
 * Contrato do Funil de atendimento (F7 · kanban do pipeline). As colunas são
 * registros por clínica: as 5 padrão nascem automaticamente e carregam
 * `systemStage` — a semântica que o detector automático (`ai/stage-detection`)
 * reconhece; colunas criadas pelo dono são manuais (cards chegam nelas por
 * drag-and-drop/menu). O detector só AVANÇA um card (por `position`) — nunca
 * regride — então o movimento manual do dono é sempre respeitado.
 */

/** Estágios do sistema, na ordem do funil (rank crescente). */
export const FUNNEL_STAGES = [
  "novo_contato",
  "interessado",
  "quero_agendar",
  "escolha_data",
  "agendado",
] as const;
export const funnelStageSchema = z.enum(FUNNEL_STAGES);
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** Posição de um estágio do sistema no funil (0 = topo). */
export function funnelStageRank(stage: FunnelStage): number {
  return FUNNEL_STAGES.indexOf(stage);
}

/** Nome padrão (editável pelo dono) de cada coluna do sistema. */
export const FUNNEL_STAGE_DEFAULT_NAMES: Record<FunnelStage, string> = {
  novo_contato: "Novo contato",
  interessado: "Interessado",
  quero_agendar: "Quero agendar",
  escolha_data: "Escolha de data",
  agendado: "Agendado",
};

/** Máximo de colunas por clínica (5 do sistema + personalizadas). */
export const MAX_PIPELINE_STAGES = 10;

/** Origem do card e de seu último movimento: detector (auto) ou dono (manual). */
export const PIPELINE_SOURCES = ["auto", "manual"] as const;
export const pipelineSourceSchema = z.enum(PIPELINE_SOURCES);
export type PipelineSource = (typeof PIPELINE_SOURCES)[number];

/** Uma coluna do board. `systemStage` null = coluna criada pelo dono. */
export const pipelineStageSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  position: z.number(),
  systemStage: funnelStageSchema.nullable(),
});
export type PipelineStageDto = z.infer<typeof pipelineStageSchema>;

/** Um card do board. Dados de contato derivados do lead/conversa vinculados. */
export const pipelineCardSchema = z.object({
  id: z.string().uuid(),
  stageId: z.string().uuid(),
  source: pipelineSourceSchema,
  /** Quem posicionou o card na coluna atual (badge "movido manualmente"). */
  stageSource: pipelineSourceSchema,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  /** Canal da conversa vinculada; null em cards manuais sem conversa. */
  channel: channelSchema.nullable(),
  conversationId: z.string().uuid().nullable(),
  leadId: z.string().uuid().nullable(),
  status: conversationStatusSchema.nullable(),
  note: z.string().nullable(),
  /** ISO 8601 — última mensagem da conversa (null em cards manuais). */
  lastMessageAt: z.string().nullable(),
  /** ISO 8601 — quando o card entrou na coluna atual. */
  stageUpdatedAt: z.string(),
  /** ISO 8601. */
  createdAt: z.string(),
});
export type PipelineCardDto = z.infer<typeof pipelineCardSchema>;

/** Resposta de GET /pipeline: colunas (ordenadas por position) + cards. */
export const pipelineResponseSchema = z.object({
  stages: z.array(pipelineStageSchema),
  cards: z.array(pipelineCardSchema),
});
export type PipelineResponse = z.infer<typeof pipelineResponseSchema>;

/** Corpo de POST /pipeline/cards — cliente adicionado à mão pelo dono. */
export const createPipelineCardSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do cliente.").max(120),
  phone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(500).optional(),
  /** Coluna de destino; ausente → primeira coluna do board. */
  stageId: z.string().uuid().optional(),
});
export type CreatePipelineCardInput = z.infer<typeof createPipelineCardSchema>;

/** Corpo de PATCH /pipeline/cards/:id — movimento manual (qualquer direção). */
export const movePipelineCardSchema = z.object({
  stageId: z.string().uuid(),
});
export type MovePipelineCardInput = z.infer<typeof movePipelineCardSchema>;

/** Corpo de POST /pipeline/stages — coluna personalizada do dono. */
export const createPipelineStageSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da coluna.").max(40),
});
export type CreatePipelineStageInput = z.infer<typeof createPipelineStageSchema>;

/** Corpo de PATCH /pipeline/stages/:id — renomear (vale p/ colunas do sistema). */
export const renamePipelineStageSchema = createPipelineStageSchema;
export type RenamePipelineStageInput = CreatePipelineStageInput;
