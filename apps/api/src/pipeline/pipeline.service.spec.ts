import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FUNNEL_STAGES, FUNNEL_STAGE_DEFAULT_NAMES } from '@dentaltrack/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { PipelineService } from './pipeline.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const CARD = '00000000-0000-0000-0000-00000000f001';
const LEAD = '00000000-0000-0000-0000-00000000d001';
const CONVO = '00000000-0000-0000-0000-00000000c001';
const CUSTOM = '00000000-0000-0000-0000-00000000a001';

const NOW = new Date('2026-07-14T12:00:00Z');

/** As 5 colunas do sistema já provisionadas (posições 0..4). */
const SYSTEM_STAGES = FUNNEL_STAGES.map((systemStage, position) => ({
  id: `00000000-0000-0000-0000-00000000b00${position}`,
  name: FUNNEL_STAGE_DEFAULT_NAMES[systemStage],
  position,
  systemStage,
}));

function makePrisma() {
  return {
    pipelineStage: {
      findMany: jest.fn().mockResolvedValue(SYSTEM_STAGES),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    pipelineCard: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    lead: { create: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  return new PipelineService(prisma as unknown as PrismaService);
}

/** Linha do banco como o Prisma devolve (com os includes do service). */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: CARD,
    stageId: SYSTEM_STAGES[0].id,
    source: 'auto',
    stageSource: 'auto',
    conversationId: CONVO,
    leadId: LEAD,
    note: null,
    stageUpdatedAt: NOW,
    createdAt: NOW,
    lead: { name: 'João Silva', phone: '11 99999-0000' },
    conversation: {
      channel: 'whatsapp',
      status: 'em_andamento',
      contactPhone: '5511999990000',
      lastMessageAt: NOW,
    },
    ...overrides,
  };
}

describe('PipelineService (funil F7)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('list: colunas + cards escopados por empresa, DTO com contato derivado', async () => {
    const prisma = makePrisma();
    prisma.pipelineCard.findMany.mockResolvedValueOnce([
      row(),
      row({
        id: '00000000-0000-0000-0000-00000000f003',
        conversationId: null,
        conversation: null,
        source: 'manual',
        stageSource: 'manual',
        lead: { name: null, phone: null },
      }),
    ]);
    const service = makeService(prisma);

    const board = await service.list(CLINIC);

    expect(prisma.pipelineCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: CLINIC } }),
    );
    expect(board.stages).toHaveLength(5);
    expect(board.stages[0]).toMatchObject({
      name: 'Novo contato',
      position: 0,
      systemStage: 'novo_contato',
    });
    expect(board.cards[0]).toMatchObject({
      id: CARD,
      stageId: SYSTEM_STAGES[0].id,
      name: 'João Silva',
      phone: '11 99999-0000',
      channel: 'whatsapp',
      status: 'em_andamento',
      lastMessageAt: NOW.toISOString(),
    });
    // Card manual sem conversa e sem telefone: campos derivados nulos.
    expect(board.cards[1]).toMatchObject({
      channel: null,
      status: null,
      phone: null,
      lastMessageAt: null,
      source: 'manual',
    });
  });

  it('list: provisiona as colunas do sistema que faltarem (1º acesso)', async () => {
    const prisma = makePrisma();
    prisma.pipelineStage.findMany
      .mockResolvedValueOnce([]) // antes: empresa sem colunas
      .mockResolvedValueOnce(SYSTEM_STAGES); // depois do provisionamento
    prisma.pipelineCard.findMany.mockResolvedValueOnce([]);
    const service = makeService(prisma);

    const board = await service.list(CLINIC);

    expect(prisma.pipelineStage.create).toHaveBeenCalledTimes(5);
    expect(prisma.pipelineStage.create).toHaveBeenCalledWith({
      data: {
        clinicId: CLINIC,
        name: 'Novo contato',
        position: 0,
        systemStage: 'novo_contato',
      },
    });
    expect(board.stages).toHaveLength(5);
  });

  it('createManual: cria Lead source=manual e o card na 1ª coluna por padrão', async () => {
    const prisma = makePrisma();
    prisma.lead.create.mockResolvedValueOnce({ id: LEAD });
    prisma.pipelineCard.create.mockResolvedValueOnce(
      row({
        conversationId: null,
        conversation: null,
        source: 'manual',
        stageSource: 'manual',
        note: 'Ligou pedindo orçamento',
      }),
    );
    const service = makeService(prisma);

    const card = await service.createManual(CLINIC, {
      name: 'João Silva',
      phone: '11 99999-0000',
      note: 'Ligou pedindo orçamento',
    });

    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: {
        clinicId: CLINIC,
        name: 'João Silva',
        phone: '11 99999-0000',
        source: 'manual',
      },
      select: { id: true },
    });
    expect(prisma.pipelineCard.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          clinicId: CLINIC,
          leadId: LEAD,
          stageId: SYSTEM_STAGES[0].id,
          source: 'manual',
          stageSource: 'manual',
          note: 'Ligou pedindo orçamento',
        },
      }),
    );
    expect(card).toMatchObject({ source: 'manual' });
  });

  it('createManual: coluna informada que não é da empresa → 404', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await expect(
      service.createManual(CLINIC, { name: 'Maria', stageId: CUSTOM }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('move: movimento manual em qualquer direção, marcando stageSource=manual', async () => {
    const prisma = makePrisma();
    prisma.pipelineCard.findFirst.mockResolvedValueOnce({ id: CARD });
    prisma.pipelineStage.findFirst.mockResolvedValueOnce({
      id: SYSTEM_STAGES[0].id,
    });
    prisma.pipelineCard.update.mockResolvedValueOnce(
      row({ stageSource: 'manual' }),
    );
    const service = makeService(prisma);

    // Regride de propósito (só o dono pode): volta para a 1ª coluna.
    const card = await service.move(CLINIC, CARD, {
      stageId: SYSTEM_STAGES[0].id,
    });

    expect(prisma.pipelineCard.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CARD },
        data: expect.objectContaining({
          stageId: SYSTEM_STAGES[0].id,
          stageSource: 'manual',
        }),
      }),
    );
    expect(card.stageSource).toBe('manual');
  });

  it('move/remove: card de outra empresa → 404 (posse cross-tenant)', async () => {
    const prisma = makePrisma();
    prisma.pipelineCard.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(
      service.move(CLINIC, CARD, { stageId: SYSTEM_STAGES[1].id }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(CLINIC, CARD)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.pipelineCard.update).not.toHaveBeenCalled();
    expect(prisma.pipelineCard.delete).not.toHaveBeenCalled();
  });

  it('createStage: coluna personalizada entra no fim do board', async () => {
    const prisma = makePrisma();
    prisma.pipelineStage.create.mockResolvedValueOnce({
      id: CUSTOM,
      name: 'Pós-venda',
      position: 5,
      systemStage: null,
    });
    const service = makeService(prisma);

    const stage = await service.createStage(CLINIC, { name: 'Pós-venda' });

    expect(prisma.pipelineStage.create).toHaveBeenCalledWith({
      data: { clinicId: CLINIC, name: 'Pós-venda', position: 5 },
      select: { id: true, name: true, position: true, systemStage: true },
    });
    expect(stage).toMatchObject({ name: 'Pós-venda', systemStage: null });
  });

  it('createStage: limite de colunas → 400 · nome duplicado → 409', async () => {
    const prisma = makePrisma();
    const ten = Array.from({ length: 10 }, (_, i) => ({
      ...SYSTEM_STAGES[0],
      id: `00000000-0000-0000-0000-00000000b0${String(i).padStart(2, '0')}`,
      name: `Coluna ${i}`,
      position: i,
      systemStage: i < 5 ? FUNNEL_STAGES[i] : null,
    }));
    prisma.pipelineStage.findMany.mockResolvedValue(ten);
    const service = makeService(prisma);

    await expect(
      service.createStage(CLINIC, { name: 'Excedente' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.pipelineStage.findMany.mockResolvedValue(SYSTEM_STAGES);
    prisma.pipelineStage.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      service.createStage(CLINIC, { name: 'Interessado' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('renameStage: renomeia (inclusive coluna do sistema), 404 cross-tenant', async () => {
    const prisma = makePrisma();
    prisma.pipelineStage.findFirst.mockResolvedValueOnce({
      id: SYSTEM_STAGES[2].id,
    });
    prisma.pipelineStage.update.mockResolvedValueOnce({
      ...SYSTEM_STAGES[2],
      name: 'Pronto para fechar',
    });
    const service = makeService(prisma);

    const stage = await service.renameStage(CLINIC, SYSTEM_STAGES[2].id, {
      name: 'Pronto para fechar',
    });
    expect(stage.name).toBe('Pronto para fechar');

    prisma.pipelineStage.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.renameStage(CLINIC, CUSTOM, { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removeStage: coluna do sistema não pode ser excluída → 400', async () => {
    const prisma = makePrisma();
    prisma.pipelineStage.findFirst.mockResolvedValueOnce({
      id: SYSTEM_STAGES[0].id,
      systemStage: 'novo_contato',
    });
    const service = makeService(prisma);

    await expect(
      service.removeStage(CLINIC, SYSTEM_STAGES[0].id),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pipelineStage.delete).not.toHaveBeenCalled();
  });

  it('removeStage: exclui coluna personalizada movendo os cards para a 1ª coluna', async () => {
    const prisma = makePrisma();
    prisma.pipelineStage.findFirst
      .mockResolvedValueOnce({ id: CUSTOM, systemStage: null }) // posse
      .mockResolvedValueOnce({ id: SYSTEM_STAGES[0].id }); // fallback
    const service = makeService(prisma);

    await expect(service.removeStage(CLINIC, CUSTOM)).resolves.toEqual({
      id: CUSTOM,
    });
    expect(prisma.pipelineCard.updateMany).toHaveBeenCalledWith({
      where: { clinicId: CLINIC, stageId: CUSTOM },
      data: expect.objectContaining({ stageId: SYSTEM_STAGES[0].id }),
    });
    expect(prisma.pipelineStage.delete).toHaveBeenCalledWith({
      where: { id: CUSTOM },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('remove: apaga só o card (lead e conversa ficam)', async () => {
    const prisma = makePrisma();
    prisma.pipelineCard.findFirst.mockResolvedValueOnce({ id: CARD });
    prisma.pipelineCard.delete.mockResolvedValueOnce(row());
    const service = makeService(prisma);

    await expect(service.remove(CLINIC, CARD)).resolves.toEqual({ id: CARD });
    expect(prisma.pipelineCard.delete).toHaveBeenCalledWith({
      where: { id: CARD },
    });
  });
});
