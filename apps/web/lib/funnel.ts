import type { FunnelStage, PipelineStageDto } from "@dentaltrack/shared";

/**
 * Apresentação das colunas do Funil de atendimento (F7). Tints existentes do
 * tema (paleta de tags) — nenhuma cor literal nova, seguindo o precedente da
 * temperatura de leads. Os NOMES vêm do servidor (colunas por clínica,
 * renomeáveis); aqui ficam as cores e os hints das colunas do sistema.
 */

interface StageMeta {
  hint: string;
  bg: string;
  fg: string;
}

const SYSTEM_META: Record<FunnelStage, StageMeta> = {
  novo_contato: {
    hint: "Acabou de chegar na conversa",
    bg: "var(--tag-blue-bg)",
    fg: "var(--tag-blue-fg)",
  },
  interessado: {
    hint: "Perguntando sobre procedimentos e valores",
    bg: "var(--tag-violet-bg)",
    fg: "var(--tag-violet-fg)",
  },
  quero_agendar: {
    hint: "Disse que quer marcar uma consulta",
    bg: "var(--tag-amber-bg)",
    fg: "var(--tag-amber-fg)",
  },
  escolha_data: {
    hint: "Negociando o melhor dia e horário",
    bg: "var(--tag-rose-bg)",
    fg: "var(--tag-rose-fg)",
  },
  agendado: {
    hint: "Agendamento confirmado (conversão)",
    bg: "var(--tag-teal-bg)",
    fg: "var(--tag-teal-fg)",
  },
};

/** Ciclo de cores para colunas personalizadas (por posição no board). */
const CUSTOM_PALETTE = [
  { bg: "var(--tag-sage-bg)", fg: "var(--tag-sage-fg)" },
  { bg: "var(--tag-teal-bg)", fg: "var(--tag-teal-fg)" },
  { bg: "var(--tag-violet-bg)", fg: "var(--tag-violet-fg)" },
  { bg: "var(--tag-amber-bg)", fg: "var(--tag-amber-fg)" },
  { bg: "var(--tag-blue-bg)", fg: "var(--tag-blue-fg)" },
] as const;

/** Cores + hint de uma coluna: fixos p/ as do sistema, ciclo p/ personalizadas. */
export function stageMeta(stage: PipelineStageDto): StageMeta {
  if (stage.systemStage) return SYSTEM_META[stage.systemStage];
  const color = CUSTOM_PALETTE[stage.position % CUSTOM_PALETTE.length];
  return { hint: "Coluna criada pela clínica (movimento manual)", ...color };
}
