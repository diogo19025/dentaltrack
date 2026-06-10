import { Test } from '@nestjs/testing';
import { RANGE_DAYS } from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const T1 = '00000000-0000-0000-0000-00000000e001';

/**
 * Cenário fixo (mesmo retorno p/ janela atual e anterior → deltas 0):
 * 2 leads; 2 conversas (1 agendada+engajada, 1 em andamento não engajada);
 * 10 mensagens do bot (50d); 1 tag dominante.
 */
function buildPrismaMock() {
  const now = new Date();
  const earlier = new Date(now.getTime() - 60_000);
  return {
    lead: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ createdAt: now }, { createdAt: now }]),
    },
    conversation: {
      findMany: jest.fn().mockResolvedValue([
        {
          status: 'agendada',
          createdAt: now,
          messages: [
            { role: 'assistant', createdAt: earlier },
            { role: 'user', createdAt: now },
          ],
        },
        {
          status: 'em_andamento',
          createdAt: now,
          messages: [
            { role: 'user', createdAt: earlier },
            { role: 'assistant', createdAt: now },
          ],
        },
      ]),
    },
    message: {
      count: jest.fn().mockResolvedValue(10),
      findMany: jest.fn().mockResolvedValue([
        { role: 'assistant', createdAt: now },
        { role: 'user', createdAt: now },
      ]),
    },
    conversationTag: {
      groupBy: jest
        .fn()
        .mockResolvedValue([{ tagId: T1, _count: { tagId: 3 } }]),
    },
    tag: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: T1, name: 'implante', color: 'teal' }]),
    },
  };
}

describe('MetricsService', () => {
  let service: MetricsService;
  let prismaMock: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prismaMock = buildPrismaMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(MetricsService);
  });

  it('calcula os 6 KPIs conforme as definições do context §10', async () => {
    const m = await service.getMetrics(CLINIC, '50d');

    expect(m.kpis.leads.value).toBe(2);
    expect(m.kpis.botMessages.value).toBe(10); // janela fixa 50d
    expect(m.kpis.responseRate.value).toBeCloseTo(0.5); // 1 engajada / 2 iniciadas
    expect(m.kpis.conversionRate.value).toBeCloseTo(0.5); // 1 agendada / 2 iniciadas
    expect(m.kpis.inProgress.value).toBe(1);
    expect(m.kpis.notCompleted.value).toBe(0);
  });

  it('monta funil (iniciadas→engajadas→agendadas) e distribuição de status', async () => {
    const m = await service.getMetrics(CLINIC, '50d');

    expect(m.funnel).toEqual({ started: 2, engaged: 1, scheduled: 1 });
    expect(m.statusDistribution).toEqual([
      { status: 'em_andamento', value: 1 },
      { status: 'agendada', value: 1 },
      { status: 'abandonada', value: 0 },
    ]);
  });

  it('retorna top tags com a cor fixa', async () => {
    const m = await service.getMetrics(CLINIC, '50d');
    expect(m.topTags).toEqual([{ name: 'implante', color: 'teal', value: 3 }]);
  });

  it('a série de linha tem um ponto por dia do período', async () => {
    const m = await service.getMetrics(CLINIC, '7d');
    expect(m.line.labels).toHaveLength(RANGE_DAYS['7d']);
    expect(m.line.bot).toHaveLength(RANGE_DAYS['7d']);
    expect(m.line.patient).toHaveLength(RANGE_DAYS['7d']);
  });

  it('range inválido não chega aqui (default já resolvido no controller)', async () => {
    const m = await service.getMetrics(CLINIC, '30d');
    expect(m.range).toBe('30d');
  });
});
