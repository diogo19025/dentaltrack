import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const CLINIC = '00000000-0000-0000-0000-0000000f1101';

/** Datas relativas a "agora" — a janela do painel é móvel (7 dias). */
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

describe('NotificationsService (sino do topbar · F11)', () => {
  let service: NotificationsService;

  const prismaMock = {
    clinicSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    conversation: { findMany: jest.fn() },
    lead: { findMany: jest.fn() },
    appointment: { findMany: jest.fn() },
    outboundMessage: { findMany: jest.fn() },
  };

  /** Zera todas as fontes — cada teste liga só o que lhe interessa. */
  function emptySources() {
    prismaMock.clinicSettings.findUnique.mockResolvedValue(null);
    prismaMock.conversation.findMany.mockResolvedValue([]);
    prismaMock.lead.findMany.mockResolvedValue([]);
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.outboundMessage.findMany.mockResolvedValue([]);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    emptySources();
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('sem eventos → painel vazio, contador zerado', async () => {
    const dto = await service.getNotifications(CLINIC);
    expect(dto.items).toEqual([]);
    expect(dto.unreadCount).toBe(0);
    expect(dto.seenAt).toBeNull();
  });

  it('mescla as fontes ordenando do mais novo para o mais velho', async () => {
    prismaMock.conversation.findMany
      .mockResolvedValueOnce([
        // conversas iniciadas
        {
          id: 'c1',
          channel: 'whatsapp',
          contactPhone: '5511999990000',
          createdAt: hoursAgo(1),
          lead: null,
        },
      ])
      .mockResolvedValueOnce([]); // abandonadas
    prismaMock.lead.findMany.mockResolvedValue([
      {
        id: 'l1',
        name: 'Maria',
        phone: '5511999990000',
        email: null,
        createdAt: hoursAgo(3),
      },
    ]);
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        id: 'a1',
        startsAt: null,
        preferredTime: 'quinta de manhã',
        createdAt: hoursAgo(2),
        lead: { name: 'Maria', phone: null },
        conversation: null,
      },
    ]);

    const dto = await service.getNotifications(CLINIC);
    expect(dto.items.map((i) => i.type)).toEqual([
      'conversa_iniciada',
      'agendamento_criado',
      'lead_capturado',
    ]);
    // Tudo não lido: a empresa nunca abriu o sino (seenAt null).
    expect(dto.unreadCount).toBe(3);
  });

  it('a manchete da conversa diz o canal; a descrição identifica o contato', async () => {
    prismaMock.conversation.findMany
      .mockResolvedValueOnce([
        {
          id: 'c1',
          channel: 'whatsapp',
          contactPhone: '5511988887777',
          createdAt: hoursAgo(1),
          lead: null,
        },
        {
          id: 'c2',
          channel: 'web',
          contactPhone: null,
          createdAt: hoursAgo(2),
          lead: { name: 'João', phone: null },
        },
      ])
      .mockResolvedValueOnce([]);

    const dto = await service.getNotifications(CLINIC);
    expect(dto.items[0]).toMatchObject({
      title: 'Nova conversa pelo WhatsApp',
      description: '5511988887777',
      channel: 'whatsapp',
    });
    expect(dto.items[1]).toMatchObject({
      title: 'Nova conversa pelo site',
      description: 'João',
      channel: 'web',
    });
  });

  it('eventos anteriores ao "visto" contam como lidos — posteriores, não', async () => {
    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      notificationsSeenAt: hoursAgo(2),
    });
    prismaMock.conversation.findMany
      .mockResolvedValueOnce([
        {
          id: 'nova',
          channel: 'web',
          contactPhone: null,
          createdAt: hoursAgo(1),
          lead: null,
        },
        {
          id: 'velha',
          channel: 'web',
          contactPhone: null,
          createdAt: hoursAgo(5),
          lead: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const dto = await service.getNotifications(CLINIC);
    expect(dto.unreadCount).toBe(1);
    expect(dto.items.find((i) => i.id.endsWith('nova'))?.unread).toBe(true);
    expect(dto.items.find((i) => i.id.endsWith('velha'))?.unread).toBe(false);
  });

  it('automação que falhou vira alerta com o rótulo do gatilho', async () => {
    prismaMock.outboundMessage.findMany.mockResolvedValue([
      {
        id: 'o1',
        kind: 'lembrete_1d',
        phone: '5511999990000',
        updatedAt: hoursAgo(1),
        lead: { name: 'Maria' },
      },
    ]);

    const dto = await service.getNotifications(CLINIC);
    expect(dto.items[0].type).toBe('automacao_falhou');
    expect(dto.items[0].title).toBe('Mensagem automática falhou');
    expect(dto.items[0].description).toContain('Maria');
  });

  it('WhatsApp desconectado vira alerta enquanto exige ação', async () => {
    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      notificationsSeenAt: null,
      whatsappInstance: 'empresa-demo',
      whatsappState: 'desconectado',
      whatsappStateAt: hoursAgo(1),
      whatsappLastError: 'Evolution indisponível',
    });

    const dto = await service.getNotifications(CLINIC);

    expect(dto.items[0]).toMatchObject({
      type: 'whatsapp_desconectado',
      title: 'WhatsApp desconectado',
      channel: 'whatsapp',
      unread: true,
    });
  });

  it('leads importados em massa não afogam o sino (filtro na query)', async () => {
    await service.getNotifications(CLINIC);
    expect(prismaMock.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ NOT: { source: 'import' } }),
      }),
    );
  });

  it('markSeen grava o marco e devolve o novo "visto"', async () => {
    prismaMock.clinicSettings.upsert.mockResolvedValue({});
    const result = await service.markSeen(CLINIC);
    expect(prismaMock.clinicSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: CLINIC } }),
    );
    // Depois de visto, o mesmo painel volta zerado.
    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      notificationsSeenAt: new Date(result.seenAt),
    });
    const dto = await service.getNotifications(CLINIC);
    expect(dto.unreadCount).toBe(0);
    expect(dto.seenAt).toBe(result.seenAt);
  });
});
