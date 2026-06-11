import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from './leads.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';

/** Relógio fixo → recência (score) determinística. */
const NOW = new Date('2026-06-11T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('LeadsService', () => {
  let service: LeadsService;
  const prismaMock = { lead: { findMany: jest.fn(), findFirst: jest.fn() } };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(LeadsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('deriva interesse (procedimento), tags distintas e status da conversa mais recente', async () => {
    const createdAt = new Date('2026-06-01T12:00:00.000Z');
    prismaMock.lead.findMany.mockResolvedValueOnce([
      {
        id: '00000000-0000-0000-0000-00000000a001',
        name: 'João',
        phone: '(11) 90000-0000',
        email: null,
        source: 'web',
        createdAt,
        conversations: [
          {
            status: 'agendada',
            lastMessageAt: hoursAgo(2),
            conversationTags: [
              { confidence: 0.9, tag: { name: 'implante', color: 'teal' } },
              { confidence: 0.7, tag: { name: 'implante', color: 'teal' } }, // duplicada → dedupe
            ],
            _count: { messages: 5 },
          },
        ],
        appointments: [{ procedure: { name: 'Implante dentário' } }],
      },
      {
        id: '00000000-0000-0000-0000-00000000a002',
        name: 'Maria',
        phone: null,
        email: null,
        source: 'web',
        createdAt,
        conversations: [
          {
            status: 'em_andamento',
            lastMessageAt: hoursAgo(1),
            conversationTags: [],
            _count: { messages: 1 },
          },
        ],
        appointments: [],
      },
    ]);

    const res = await service.list(CLINIC);

    expect(res.summary).toEqual({
      total: 2,
      agendada: 1,
      andamento: 1,
      abandonada: 0,
    });
    expect(res.leads[0]).toMatchObject({
      name: 'João',
      interest: 'Implante dentário',
      status: 'agendada',
      tags: [{ name: 'implante', color: 'teal' }],
      createdAt: createdAt.toISOString(),
    });
    expect(res.leads[1]).toMatchObject({
      name: 'Maria',
      interest: null,
      status: 'em_andamento',
    });
  });

  it('interesse cai para a 1ª tag quando não há agendamento', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([
      {
        id: '00000000-0000-0000-0000-00000000a003',
        name: 'Ana',
        phone: null,
        email: null,
        source: 'web',
        createdAt: new Date(),
        conversations: [
          {
            status: 'abandonada',
            lastMessageAt: hoursAgo(240),
            conversationTags: [
              { confidence: 0.8, tag: { name: 'clareamento', color: 'amber' } },
            ],
            _count: { messages: 4 },
          },
        ],
        appointments: [],
      },
    ]);

    const res = await service.list(CLINIC);
    expect(res.leads[0].interest).toBe('clareamento');
    expect(res.summary.abandonada).toBe(1);
  });

  it('calcula score/temperatura por lead e a contagem por faixa no response', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([
      {
        // Agendado recente: 30 + 21.875 (5 msgs) + 10.8 (tag 0.9) + 15 (<24h) → 78
        id: '00000000-0000-0000-0000-00000000a004',
        name: 'João',
        phone: null,
        email: null,
        source: 'web',
        createdAt: NOW,
        conversations: [
          {
            status: 'agendada',
            lastMessageAt: hoursAgo(2),
            conversationTags: [
              { confidence: 0.9, tag: { name: 'implante', color: 'teal' } },
            ],
            _count: { messages: 5 },
          },
        ],
        appointments: [{ procedure: { name: 'Implante dentário' } }],
      },
      {
        // Recém-chegado: 4.375 (1 msg) + 15 (<24h) → 19
        id: '00000000-0000-0000-0000-00000000a005',
        name: 'Maria',
        phone: null,
        email: null,
        source: 'web',
        createdAt: NOW,
        conversations: [
          {
            status: 'em_andamento',
            lastMessageAt: hoursAgo(1),
            conversationTags: [],
            _count: { messages: 1 },
          },
        ],
        appointments: [],
      },
      {
        // Abandonado antigo: 17.5 (4 msgs) + 9.6 (tag 0.8) + 0 − 20 → 7
        id: '00000000-0000-0000-0000-00000000a006',
        name: 'Ana',
        phone: null,
        email: null,
        source: 'web',
        createdAt: NOW,
        conversations: [
          {
            status: 'abandonada',
            lastMessageAt: hoursAgo(240),
            conversationTags: [
              { confidence: 0.8, tag: { name: 'clareamento', color: 'amber' } },
            ],
            _count: { messages: 4 },
          },
        ],
        appointments: [],
      },
    ]);

    const res = await service.list(CLINIC);

    expect(res.leads[0]).toMatchObject({ score: 78, temperature: 'quente' });
    expect(res.leads[1]).toMatchObject({ score: 19, temperature: 'fraco' });
    expect(res.leads[2]).toMatchObject({ score: 7, temperature: 'fraco' });
    expect(res.temperatures).toEqual({ quente: 1, medio: 0, fraco: 2 });
  });

  it('agrega sinais entre conversas: agendamento via status, msgs somadas e maior confiança por tag', async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([
      {
        // Sem appointment, mas com conversa `agendada` → conta como conversão.
        // 30 + 21.875 (2+3 msgs) + 10.8 (implante max 0.9) + 15 (<24h) → 78
        id: '00000000-0000-0000-0000-00000000a007',
        name: 'Carlos',
        phone: null,
        email: null,
        source: 'web',
        createdAt: NOW,
        conversations: [
          {
            status: 'em_andamento',
            lastMessageAt: hoursAgo(3),
            conversationTags: [
              { confidence: 0.5, tag: { name: 'implante', color: 'teal' } },
            ],
            _count: { messages: 2 },
          },
          {
            status: 'agendada',
            lastMessageAt: hoursAgo(80),
            conversationTags: [
              { confidence: 0.9, tag: { name: 'implante', color: 'teal' } },
            ],
            _count: { messages: 3 },
          },
        ],
        appointments: [],
      },
    ]);

    const res = await service.list(CLINIC);

    expect(res.leads[0].tags).toEqual([{ name: 'implante', color: 'teal' }]);
    expect(res.leads[0]).toMatchObject({ score: 78, temperature: 'quente' });
    expect(res.temperatures).toEqual({ quente: 1, medio: 0, fraco: 0 });
  });

  describe('detail (GET /leads/:id)', () => {
    const LEAD_ID = '00000000-0000-0000-0000-00000000a010';

    it('expande conversas (canal/contagens/tags) e agendamentos, com o mesmo score do list', async () => {
      const capturedAt = new Date('2026-06-09T10:00:00.000Z');
      prismaMock.lead.findFirst.mockResolvedValueOnce({
        id: LEAD_ID,
        name: 'João',
        phone: '(11) 90000-0000',
        email: 'joao@exemplo.com',
        source: 'web',
        createdAt: capturedAt,
        conversations: [
          {
            id: '00000000-0000-0000-0000-00000000c001',
            channel: 'web',
            status: 'agendada',
            lastMessageAt: hoursAgo(2),
            createdAt: hoursAgo(3),
            conversationTags: [
              { confidence: 0.9, tag: { name: 'implante', color: 'teal' } },
            ],
            // 5 do paciente (score) + 4 do bot → 9 exibidas no painel.
            messages: [
              ...Array.from({ length: 5 }, () => ({ role: 'user' })),
              ...Array.from({ length: 4 }, () => ({ role: 'assistant' })),
            ],
          },
        ],
        appointments: [
          {
            id: '00000000-0000-0000-0000-00000000e001',
            preferredTime: 'quinta de manhã',
            createdAt: hoursAgo(2),
            procedure: { name: 'Implante dentário' },
          },
        ],
      });

      const res = await service.detail(CLINIC, LEAD_ID);

      expect(prismaMock.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: LEAD_ID, clinicId: CLINIC } }),
      );
      // Agendado recente: 30 + 21.875 + 10.8 + 15 → 78 (idem list()).
      expect(res).toMatchObject({
        name: 'João',
        interest: 'Implante dentário',
        status: 'agendada',
        score: 78,
        temperature: 'quente',
      });
      expect(res.conversations).toEqual([
        expect.objectContaining({
          id: '00000000-0000-0000-0000-00000000c001',
          channel: 'web',
          status: 'agendada',
          messageCount: 9,
          lastMessageAt: hoursAgo(2).toISOString(),
          tags: [{ name: 'implante', color: 'teal' }],
        }),
      ]);
      expect(res.appointments).toEqual([
        expect.objectContaining({
          procedure: 'Implante dentário',
          preferredTime: 'quinta de manhã',
        }),
      ]);
    });

    it('lança 404 quando o lead não existe ou é de outra clínica', async () => {
      prismaMock.lead.findFirst.mockResolvedValueOnce(null);

      await expect(service.detail(CLINIC, LEAD_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
