import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreatePipelineCardInput,
  type CreatePipelineStageInput,
  MAX_PIPELINE_STAGES,
  type MovePipelineCardInput,
  type PipelineCardDto,
  type PipelineResponse,
  type PipelineStageDto,
  type RenamePipelineStageInput,
} from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  ensurePipelineStages,
  type PipelineStageRow,
} from './pipeline-stages';

/** `include` padrão de um card: contato do lead + canal/atividade da conversa. */
const CARD_INCLUDE = {
  lead: { select: { name: true, phone: true } },
  conversation: {
    select: {
      channel: true,
      status: true,
      contactPhone: true,
      lastMessageAt: true,
    },
  },
} as const;

type CardRow = {
  id: string;
  stageId: string;
  source: 'auto' | 'manual';
  stageSource: 'auto' | 'manual';
  conversationId: string | null;
  leadId: string | null;
  note: string | null;
  stageUpdatedAt: Date;
  createdAt: Date;
  lead: { name: string | null; phone: string | null } | null;
  conversation: {
    channel: 'web' | 'whatsapp';
    status: 'em_andamento' | 'agendada' | 'abandonada';
    contactPhone: string | null;
    lastMessageAt: Date | null;
  } | null;
};

/**
 * Funil de atendimento (F7): board kanban com colunas por clínica e um card
 * por contato. As 5 colunas do sistema são provisionadas automaticamente
 * (`ensurePipelineStages`) e recebem os movimentos do detector; o dono cria/
 * renomeia/exclui colunas personalizadas (até MAX_PIPELINE_STAGES) e move os
 * cards à vontade. Tudo escopado por `clinicId` (multi-tenant).
 */
@Injectable()
export class PipelineService {
  constructor(private readonly prisma: PrismaService) {}

  /** Board completo: colunas (por posição) + cards (atividade mais recente 1º). */
  async list(clinicId: string): Promise<PipelineResponse> {
    const stages = await ensurePipelineStages(this.prisma, clinicId);
    const rows = (await this.prisma.pipelineCard.findMany({
      where: { clinicId },
      include: CARD_INCLUDE,
      orderBy: { stageUpdatedAt: 'desc' },
    })) as CardRow[];
    return { stages: stages.map(toStageDto), cards: rows.map(toCardDto) };
  }

  /**
   * Cliente adicionado à mão pelo dono (ex.: chegou por telefone/indicação).
   * Cria um Lead `source=manual` — ele aparece também na página de leads — e o
   * card correspondente, na coluna escolhida (ou na primeira do board).
   */
  async createManual(
    clinicId: string,
    input: CreatePipelineCardInput,
  ): Promise<PipelineCardDto> {
    const stages = await ensurePipelineStages(this.prisma, clinicId);
    const stage = input.stageId
      ? stages.find((s) => s.id === input.stageId)
      : stages[0];
    if (!stage)
      throw new NotFoundException(`Coluna ${input.stageId} não encontrada.`);

    const lead = await this.prisma.lead.create({
      data: {
        clinicId,
        name: input.name,
        phone: input.phone?.trim() || null,
        source: 'manual',
      },
      select: { id: true },
    });
    const row = (await this.prisma.pipelineCard.create({
      data: {
        clinicId,
        leadId: lead.id,
        stageId: stage.id,
        source: 'manual',
        stageSource: 'manual',
        note: input.note?.trim() || null,
      },
      include: CARD_INCLUDE,
    })) as CardRow;
    return toCardDto(row);
  }

  /**
   * Movimento manual do dono — qualquer direção/coluna. Marca
   * `stageSource=manual`; o detector automático nunca regride um card, então a
   * decisão fica de pé até a conversa evoluir além dela. 404 cross-tenant.
   */
  async move(
    clinicId: string,
    id: string,
    input: MovePipelineCardInput,
  ): Promise<PipelineCardDto> {
    await this.assertCardOwned(clinicId, id);
    await this.assertStageOwned(clinicId, input.stageId);
    const row = (await this.prisma.pipelineCard.update({
      where: { id },
      data: {
        stageId: input.stageId,
        stageSource: 'manual',
        stageUpdatedAt: new Date(),
      },
      include: CARD_INCLUDE,
    })) as CardRow;
    return toCardDto(row);
  }

  /** Remove um card do board (não apaga lead nem conversa). 404 cross-tenant. */
  async remove(clinicId: string, id: string): Promise<{ id: string }> {
    await this.assertCardOwned(clinicId, id);
    await this.prisma.pipelineCard.delete({ where: { id } });
    return { id };
  }

  /**
   * Coluna personalizada do dono (no fim do board). Limite de
   * MAX_PIPELINE_STAGES colunas por clínica; nome único → 409.
   */
  async createStage(
    clinicId: string,
    input: CreatePipelineStageInput,
  ): Promise<PipelineStageDto> {
    const stages = await ensurePipelineStages(this.prisma, clinicId);
    if (stages.length >= MAX_PIPELINE_STAGES) {
      throw new BadRequestException(
        `Limite de ${MAX_PIPELINE_STAGES} colunas atingido.`,
      );
    }
    const position = Math.max(...stages.map((s) => s.position)) + 1;
    try {
      const stage = (await this.prisma.pipelineStage.create({
        data: { clinicId, name: input.name, position },
        select: { id: true, name: true, position: true, systemStage: true },
      })) as PipelineStageRow;
      return toStageDto(stage);
    } catch (err) {
      throw this.asConflict(err, input.name);
    }
  }

  /** Renomeia uma coluna (vale também para as do sistema). 404 cross-tenant. */
  async renameStage(
    clinicId: string,
    id: string,
    input: RenamePipelineStageInput,
  ): Promise<PipelineStageDto> {
    await this.assertStageOwned(clinicId, id);
    try {
      const stage = (await this.prisma.pipelineStage.update({
        where: { id },
        data: { name: input.name },
        select: { id: true, name: true, position: true, systemStage: true },
      })) as PipelineStageRow;
      return toStageDto(stage);
    } catch (err) {
      throw this.asConflict(err, input.name);
    }
  }

  /**
   * Exclui uma coluna personalizada. Colunas do sistema não podem ser
   * excluídas (o detector automático depende delas) → 400. Os cards da coluna
   * excluída voltam para a primeira coluna do board (transação).
   */
  async removeStage(clinicId: string, id: string): Promise<{ id: string }> {
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id, clinicId },
      select: { id: true, systemStage: true },
    });
    if (!stage) throw new NotFoundException(`Coluna ${id} não encontrada.`);
    if (stage.systemStage) {
      throw new BadRequestException(
        'Colunas padrão do funil não podem ser excluídas (o agente as usa para mover os cards automaticamente). Você pode renomeá-la.',
      );
    }
    const fallback = await this.prisma.pipelineStage.findFirst({
      where: { clinicId, id: { not: id } },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!fallback)
      throw new BadRequestException('O board precisa de ao menos uma coluna.');

    await this.prisma.$transaction([
      this.prisma.pipelineCard.updateMany({
        where: { clinicId, stageId: id },
        data: {
          stageId: fallback.id,
          stageSource: 'manual',
          stageUpdatedAt: new Date(),
        },
      }),
      this.prisma.pipelineStage.delete({ where: { id } }),
    ]);
    return { id };
  }

  private async assertCardOwned(clinicId: string, id: string): Promise<void> {
    const card = await this.prisma.pipelineCard.findFirst({
      where: { id, clinicId },
      select: { id: true },
    });
    if (!card) throw new NotFoundException(`Card ${id} não encontrado.`);
  }

  private async assertStageOwned(clinicId: string, id: string): Promise<void> {
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id, clinicId },
      select: { id: true },
    });
    if (!stage) throw new NotFoundException(`Coluna ${id} não encontrada.`);
  }

  /** P2002 (nome duplicado na clínica) → 409; o resto propaga. */
  private asConflict(err: unknown, name: string): unknown {
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(`Já existe uma coluna chamada "${name}".`);
    }
    return err;
  }
}

/** Linha de coluna → DTO do contrato. */
function toStageDto(row: PipelineStageRow): PipelineStageDto {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    systemStage: row.systemStage,
  };
}

/** Linha do banco → DTO do contrato (nome/telefone derivados do lead/conversa). */
function toCardDto(row: CardRow): PipelineCardDto {
  return {
    id: row.id,
    stageId: row.stageId,
    source: row.source,
    stageSource: row.stageSource,
    name: row.lead?.name ?? null,
    phone: row.lead?.phone ?? row.conversation?.contactPhone ?? null,
    channel: row.conversation?.channel ?? null,
    conversationId: row.conversationId,
    leadId: row.leadId,
    status: row.conversation?.status ?? null,
    note: row.note,
    lastMessageAt: row.conversation?.lastMessageAt?.toISOString() ?? null,
    stageUpdatedAt: row.stageUpdatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
