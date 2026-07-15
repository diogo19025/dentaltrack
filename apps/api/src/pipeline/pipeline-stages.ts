import {
  FUNNEL_STAGES,
  FUNNEL_STAGE_DEFAULT_NAMES,
  type FunnelStage,
} from '@dentaltrack/shared';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Provisionamento das colunas do Funil (F7), compartilhado pelo módulo REST e
 * pelo detector automático (`ai/stage-detection.ts` — fora do DI do Nest, por
 * isso função pura sobre o prisma).
 */

/** Linha de coluna como o board e o detector consomem. */
export interface PipelineStageRow {
  id: string;
  name: string;
  position: number;
  systemStage: FunnelStage | null;
}

/**
 * Garante as 5 colunas do sistema da clínica (idempotente e race-safe: o
 * unique (clinicId, systemStage) segura criações concorrentes de turnos
 * paralelos) e retorna todas as colunas ordenadas por posição.
 */
export async function ensurePipelineStages(
  prisma: PrismaService,
  clinicId: string,
): Promise<PipelineStageRow[]> {
  const existing = (await prisma.pipelineStage.findMany({
    where: { clinicId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, position: true, systemStage: true },
  })) as PipelineStageRow[];

  const have = new Set(existing.map((s) => s.systemStage).filter(Boolean));
  const missing = FUNNEL_STAGES.filter((s) => !have.has(s));
  if (missing.length === 0) return existing;

  let position =
    existing.length > 0 ? Math.max(...existing.map((s) => s.position)) + 1 : 0;
  for (const systemStage of missing) {
    try {
      await prisma.pipelineStage.create({
        data: {
          clinicId,
          name: FUNNEL_STAGE_DEFAULT_NAMES[systemStage],
          position: position++,
          systemStage,
        },
      });
    } catch {
      // Corrida (outro turno criou a mesma coluna) ou nome já usado — segue.
    }
  }
  return (await prisma.pipelineStage.findMany({
    where: { clinicId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, position: true, systemStage: true },
  })) as PipelineStageRow[];
}
