jest.mock('./model', () => ({ getModel: jest.fn(() => 'model:google') }));
jest.mock('ai', () => ({ generateObject: jest.fn() }));

import { generateObject } from 'ai';
import { FUNNEL_STAGES, FUNNEL_STAGE_DEFAULT_NAMES } from '@dentaltrack/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { detectFunnelStage } from './stage-detection';

const generateObjectMock = generateObject as jest.MockedFunction<
  typeof generateObject
>;

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const CONVO = '00000000-0000-0000-0000-00000000c001';
const CARD = '00000000-0000-0000-0000-00000000f001';
const LEAD = '00000000-0000-0000-0000-00000000d001';

/** As 5 colunas do sistema da empresa (posições 0..4). */
const STAGES = FUNNEL_STAGES.map((systemStage, position) => ({
  id: `00000000-0000-0000-0000-00000000b00${position}`,
  name: FUNNEL_STAGE_DEFAULT_NAMES[systemStage],
  position,
  systemStage,
}));
const stageId = (s: (typeof FUNNEL_STAGES)[number]) =>
  STAGES.find((row) => row.systemStage === s)!.id;

function makePrisma() {
  return {
    conversation: { findFirst: jest.fn() },
    message: { findMany: jest.fn() },
    pipelineStage: {
      findMany: jest.fn().mockResolvedValue(STAGES),
      create: jest.fn(),
    },
    pipelineCard: { upsert: jest.fn(), update: jest.fn() },
  };
}

function ctx(prisma: ReturnType<typeof makePrisma>) {
  return {
    prisma: prisma as unknown as PrismaService,
    clinicId: CLINIC,
    conversationId: CONVO,
  };
}

const msg = (role: 'user' | 'assistant', content: string) => ({
  role,
  content,
});

describe('detectFunnelStage (funil F7)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('garante o card da conversa (upsert na coluna novo_contato, vinculando o lead)', async () => {
    const prisma = makePrisma();
    prisma.conversation.findFirst.mockResolvedValueOnce({
      status: 'em_andamento',
      leadId: LEAD,
    });
    prisma.pipelineCard.upsert.mockResolvedValueOnce({
      id: CARD,
      stageId: stageId('novo_contato'),
    });
    prisma.message.findMany.mockResolvedValueOnce([
      msg('user', 'oi, tudo bem?'),
    ]);

    await detectFunnelStage(ctx(prisma));

    expect(prisma.pipelineCard.upsert).toHaveBeenCalledWith({
      where: { conversationId: CONVO },
      update: { leadId: LEAD },
      create: {
        clinicId: CLINIC,
        conversationId: CONVO,
        leadId: LEAD,
        stageId: stageId('novo_contato'),
      },
      select: { id: true, stageId: true },
    });
    // Nenhuma keyword casou → não chama a IA nem move o card.
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(prisma.pipelineCard.update).not.toHaveBeenCalled();
  });

  it('conversa agendada → coluna agendado direto, sem gastar IA', async () => {
    const prisma = makePrisma();
    prisma.conversation.findFirst.mockResolvedValueOnce({
      status: 'agendada',
      leadId: null,
    });
    prisma.pipelineCard.upsert.mockResolvedValueOnce({
      id: CARD,
      stageId: stageId('escolha_data'),
    });

    await detectFunnelStage(ctx(prisma));

    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(prisma.pipelineCard.update).toHaveBeenCalledWith({
      where: { id: CARD },
      data: expect.objectContaining({
        stageId: stageId('agendado'),
        stageSource: 'auto',
      }),
    });
  });

  it('keyword + confirmação da IA acima do limiar → avança o card', async () => {
    const prisma = makePrisma();
    prisma.conversation.findFirst.mockResolvedValueOnce({
      status: 'em_andamento',
      leadId: null,
    });
    prisma.pipelineCard.upsert.mockResolvedValueOnce({
      id: CARD,
      stageId: stageId('novo_contato'),
    });
    prisma.message.findMany.mockResolvedValueOnce([
      msg('user', 'ok, quero agendar uma consulta'),
    ]);
    generateObjectMock.mockResolvedValueOnce({
      object: { stage: 'quero_agendar', confidence: 0.9 },
    } as never);

    await detectFunnelStage(ctx(prisma));

    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(prisma.pipelineCard.update).toHaveBeenCalledWith({
      where: { id: CARD },
      data: expect.objectContaining({
        stageId: stageId('quero_agendar'),
        stageSource: 'auto',
      }),
    });
  });

  it('só avança: estágio detectado atrás do atual não é candidato (respeita o manual)', async () => {
    const prisma = makePrisma();
    prisma.conversation.findFirst.mockResolvedValueOnce({
      status: 'em_andamento',
      leadId: null,
    });
    // Dono posicionou o card manualmente em escolha_data; a conversa só tem
    // sinais de "quero agendar" (coluna anterior) → nada a fazer.
    prisma.pipelineCard.upsert.mockResolvedValueOnce({
      id: CARD,
      stageId: stageId('escolha_data'),
    });
    prisma.message.findMany.mockResolvedValueOnce([
      msg('user', 'quero agendar uma consulta'),
    ]);

    await detectFunnelStage(ctx(prisma));

    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(prisma.pipelineCard.update).not.toHaveBeenCalled();
  });

  it('card numa coluna personalizada adiante não regride (posição manda)', async () => {
    const prisma = makePrisma();
    const custom = {
      id: '00000000-0000-0000-0000-00000000a001',
      name: 'Pós-venda',
      position: 5,
      systemStage: null,
    };
    prisma.pipelineStage.findMany.mockResolvedValue([...STAGES, custom]);
    prisma.conversation.findFirst.mockResolvedValueOnce({
      status: 'em_andamento',
      leadId: null,
    });
    prisma.pipelineCard.upsert.mockResolvedValueOnce({
      id: CARD,
      stageId: custom.id,
    });
    prisma.message.findMany.mockResolvedValueOnce([
      msg('user', 'quero agendar uma consulta'),
    ]);

    await detectFunnelStage(ctx(prisma));

    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(prisma.pipelineCard.update).not.toHaveBeenCalled();
  });

  it('ignora confiança abaixo do limiar e estágio fora dos candidatos', async () => {
    const prisma = makePrisma();
    prisma.conversation.findFirst.mockResolvedValue({
      status: 'em_andamento',
      leadId: null,
    });
    prisma.pipelineCard.upsert.mockResolvedValue({
      id: CARD,
      stageId: stageId('novo_contato'),
    });
    prisma.message.findMany.mockResolvedValue([
      msg('user', 'quero marcar um horário'),
    ]);

    generateObjectMock.mockResolvedValueOnce({
      object: { stage: 'quero_agendar', confidence: 0.2 },
    } as never);
    await detectFunnelStage(ctx(prisma));

    generateObjectMock.mockResolvedValueOnce({
      object: { stage: 'estagio_inventado', confidence: 0.99 },
    } as never);
    await detectFunnelStage(ctx(prisma));

    expect(prisma.pipelineCard.update).not.toHaveBeenCalled();
  });

  it('a pergunta do assistente também sinaliza o estágio (escolha_data)', async () => {
    const prisma = makePrisma();
    prisma.conversation.findFirst.mockResolvedValueOnce({
      status: 'em_andamento',
      leadId: null,
    });
    prisma.pipelineCard.upsert.mockResolvedValueOnce({
      id: CARD,
      stageId: stageId('quero_agendar'),
    });
    prisma.message.findMany.mockResolvedValueOnce([
      msg('assistant', 'Perfeito! Qual seria a melhor data para você?'),
      msg('user', 'pode ser sim'),
    ]);
    generateObjectMock.mockResolvedValueOnce({
      object: { stage: 'escolha_data', confidence: 0.85 },
    } as never);

    await detectFunnelStage(ctx(prisma));

    expect(prisma.pipelineCard.update).toHaveBeenCalledWith({
      where: { id: CARD },
      data: expect.objectContaining({ stageId: stageId('escolha_data') }),
    });
  });

  it('nunca lança: falha da IA é engolida (best-effort)', async () => {
    const prisma = makePrisma();
    prisma.conversation.findFirst.mockResolvedValueOnce({
      status: 'em_andamento',
      leadId: null,
    });
    prisma.pipelineCard.upsert.mockResolvedValueOnce({
      id: CARD,
      stageId: stageId('novo_contato'),
    });
    prisma.message.findMany.mockResolvedValueOnce([
      msg('user', 'quero agendar'),
    ]);
    generateObjectMock.mockRejectedValueOnce(new Error('429'));

    await expect(detectFunnelStage(ctx(prisma))).resolves.toBeUndefined();
    expect(prisma.pipelineCard.update).not.toHaveBeenCalled();
  });

  it('conversa fora da empresa → no-op (escopo por tenant)', async () => {
    const prisma = makePrisma();
    prisma.conversation.findFirst.mockResolvedValueOnce(null);

    await detectFunnelStage(ctx(prisma));

    expect(prisma.pipelineCard.upsert).not.toHaveBeenCalled();
  });
});
