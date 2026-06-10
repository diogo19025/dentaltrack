import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from './leads.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';

describe('LeadsService', () => {
  let service: LeadsService;
  const prismaMock = { lead: { findMany: jest.fn() } };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(LeadsService);
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
            conversationTags: [
              { tag: { name: 'implante', color: 'teal' } },
              { tag: { name: 'implante', color: 'teal' } }, // duplicada → dedupe
            ],
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
        conversations: [{ status: 'em_andamento', conversationTags: [] }],
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
            conversationTags: [
              { tag: { name: 'clareamento', color: 'amber' } },
            ],
          },
        ],
        appointments: [],
      },
    ]);

    const res = await service.list(CLINIC);
    expect(res.leads[0].interest).toBe('clareamento');
    expect(res.summary.abandonada).toBe(1);
  });
});
