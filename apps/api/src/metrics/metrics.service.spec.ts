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
    appointment: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
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

  describe('bookings (agendamentos do período)', () => {
    it('conta registrados, ainda de pé e cancelados no período', async () => {
      // A ordem é a do Promise.all em `bookings()`: criados, ativos, cancelados.
      prismaMock.appointment.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(4);

      const m = await service.getMetrics(CLINIC, '7d');

      expect(m.bookings).toEqual({ created: 10, active: 7, canceled: 4 });
    });

    it('cancelar não desfaz a conversão da conversa', async () => {
      prismaMock.appointment.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      const m = await service.getMetrics(CLINIC, '50d');

      // A conversa segue `agendada` — funil, KPI e distribuição intactos.
      expect(m.funnel.scheduled).toBe(1);
      expect(m.kpis.conversionRate.value).toBeCloseTo(0.5);
      // O que muda é a leitura ao lado: nenhum agendamento de pé.
      expect(m.bookings.active).toBe(0);
      expect(m.bookings.canceled).toBe(1);
    });

    it('cancelados usam `canceledAt`, então alcançam agendamento antigo', async () => {
      await service.getMetrics(CLINIC, '7d');

      const canceledQuery = prismaMock.appointment.count.mock.calls[2][0];
      expect(canceledQuery.where).toHaveProperty('canceledAt');
      expect(canceledQuery.where).not.toHaveProperty('createdAt');
    });
  });

  describe('retention (abandono × recorrência)', () => {
    const LEAD_A = '00000000-0000-0000-0000-00000000a001';
    const LEAD_B = '00000000-0000-0000-0000-00000000b001';
    const CONV_1 = '00000000-0000-0000-0000-0000000c0001';
    const CONV_2 = '00000000-0000-0000-0000-0000000c0002';
    const CONV_3 = '00000000-0000-0000-0000-0000000c0003';

    it('sem agendamentos: séries zeradas e taxa 0', async () => {
      const m = await service.getMetrics(CLINIC, '7d');
      expect(m.retention.labels).toHaveLength(RANGE_DAYS['7d']);
      expect(m.retention.abandoned).toHaveLength(RANGE_DAYS['7d']);
      expect(m.retention.recurrent).toHaveLength(RANGE_DAYS['7d']);
      expect(m.retention.recurrentLeads).toBe(0);
      expect(m.retention.recurrenceRate).toBe(0);
    });

    it('lead que volta em OUTRA conversa para agendar de novo é recorrente', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 2 * 24 * 3_600_000);
      prismaMock.appointment.findMany.mockResolvedValue([
        // Lead A: agendou, voltou em outra conversa → 1 retorno.
        { id: 'a1', leadId: LEAD_A, conversationId: CONV_1, createdAt: past },
        { id: 'a2', leadId: LEAD_A, conversationId: CONV_2, createdAt: now },
        // Lead B: 2 agendamentos na MESMA conversa → não é retorno.
        { id: 'b1', leadId: LEAD_B, conversationId: CONV_3, createdAt: past },
        { id: 'b2', leadId: LEAD_B, conversationId: CONV_3, createdAt: now },
      ]);

      const m = await service.getMetrics(CLINIC, '7d');

      expect(m.retention.recurrentLeads).toBe(1); // só o lead A
      // Taxa all-time: 1 recorrente / 2 leads com agendamento.
      expect(m.retention.recurrenceRate).toBeCloseTo(0.5);
      // O evento de retorno cai no bucket de hoje.
      const total = m.retention.recurrent.reduce((a, b) => a + b, 0);
      expect(total).toBe(1);
      expect(m.retention.recurrent[RANGE_DAYS['7d'] - 1]).toBe(1);
    });

    it('conversas abandonadas do período entram na série de abandono', async () => {
      const now = new Date();
      prismaMock.conversation.findMany.mockResolvedValue([
        {
          status: 'abandonada',
          createdAt: now,
          lastMessageAt: now,
          messages: [{ role: 'assistant', createdAt: now }],
        },
        {
          status: 'agendada',
          createdAt: now,
          lastMessageAt: now,
          messages: [],
        },
      ]);

      const m = await service.getMetrics(CLINIC, '7d');

      expect(m.retention.abandonedTotal).toBe(1);
      const total = m.retention.abandoned.reduce((a, b) => a + b, 0);
      expect(total).toBe(1);
    });
  });
});
