import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_AUTOMATION_SETTINGS } from '@dentaltrack/shared';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from '../whatsapp/evolution.service';
import { AutomationSettingsService } from './automation-settings.service';
import { reminderKey } from './automation-keys';
import { HolidaysService } from './holidays.service';
import { OptOutService } from './opt-out.service';
import { OutboundService } from './outbound.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const CONVERSATION = '22222222-2222-2222-2222-222222222222';
const APPOINTMENT = '33333333-3333-3333-3333-333333333333';

/** Quarta-feira, 09/09/2026, 10:00 em São Paulo. */
const NOW = new Date('2026-09-09T13:00:00.000Z');

describe('OutboundService (fila de saída · F9)', () => {
  let outbound: OutboundService;

  const prismaMock = {
    outboundMessage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    clinicSettings: { findUnique: jest.fn() },
    appointment: { findFirst: jest.fn() },
    message: { findFirst: jest.fn() },
    conversation: { updateMany: jest.fn() },
  };
  const settingsMock = { get: jest.fn() };
  const holidaysMock = { isHoliday: jest.fn() };
  const optOutMock = { isOptedOut: jest.fn() };
  const evolutionMock = {
    isConfigured: jest.fn(),
    sendText: jest.fn(),
    resolveLidJid: jest.fn(),
  };
  const conversationsMock = {
    appendMessage: jest.fn(),
    resolveByPhone: jest.fn(),
  };
  const configMock = {
    // Sem pausa entre envios nos testes — a higiene anti-ban é verificada pelo
    // caminho do código, não esperando 4 segundos por mensagem.
    get: jest.fn((key: string) =>
      key === 'OUTBOUND_THROTTLE_MS' ? 0 : undefined,
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    settingsMock.get.mockResolvedValue({ ...DEFAULT_AUTOMATION_SETTINGS });
    holidaysMock.isHoliday.mockResolvedValue(false);
    optOutMock.isOptedOut.mockResolvedValue(false);
    evolutionMock.isConfigured.mockReturnValue(true);
    evolutionMock.resolveLidJid.mockResolvedValue(null);
    evolutionMock.sendText.mockResolvedValue(undefined);
    prismaMock.outboundMessage.findUnique.mockResolvedValue(null);
    prismaMock.outboundMessage.count.mockResolvedValue(0);
    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      whatsappInstance: 'dentaltrack',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        OutboundService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AutomationSettingsService, useValue: settingsMock },
        { provide: HolidaysService, useValue: holidaysMock },
        { provide: OptOutService, useValue: optOutMock },
        { provide: EvolutionService, useValue: evolutionMock },
        { provide: ConversationsService, useValue: conversationsMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();
    outbound = moduleRef.get(OutboundService);
  });

  const baseEnqueue = {
    clinicId: CLINIC,
    kind: 'lembrete_3d' as const,
    dedupeKey: 'lembrete_3d:x:1',
    scheduledFor: new Date('2026-09-09T13:00:00.000Z'), // 10:00 em SP
    body: 'Olá!',
    phone: '5511999998888',
  };

  const created = () => prismaMock.outboundMessage.create.mock.calls[0][0].data;

  describe('enqueue — idempotência', () => {
    it('mesma chave não cria uma segunda mensagem', async () => {
      prismaMock.outboundMessage.findUnique.mockResolvedValueOnce({ id: 'x' });

      expect(await outbound.enqueue(baseEnqueue)).toBe('duplicado');
      expect(prismaMock.outboundMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('enqueue — o que nunca poderia sair vira registro suprimido', () => {
    it('sem telefone', async () => {
      // Vira linha, e não silêncio: o dono precisa ver que o lembrete não saiu
      // e por quê, em vez de olhar para uma fila vazia.
      expect(await outbound.enqueue({ ...baseEnqueue, phone: null })).toBe(
        'suprimido',
      );
      expect(created()).toMatchObject({
        status: 'suprimido',
        reason: 'sem_telefone',
      });
    });

    it('contato descadastrado', async () => {
      optOutMock.isOptedOut.mockResolvedValueOnce(true);

      expect(await outbound.enqueue(baseEnqueue)).toBe('suprimido');
      expect(created()).toMatchObject({
        status: 'suprimido',
        reason: 'opt_out',
      });
    });

    it('empresa sem WhatsApp conectado', async () => {
      prismaMock.clinicSettings.findUnique.mockResolvedValueOnce({
        whatsappInstance: null,
      });

      expect(await outbound.enqueue(baseEnqueue)).toBe('suprimido');
      expect(created()).toMatchObject({ reason: 'whatsapp_nao_configurado' });
    });
  });

  describe('enqueue — janela de envio', () => {
    it('antes da abertura, adia para o começo da janela do mesmo dia', async () => {
      // 06:00 em SP → deve virar 08:00 em SP (11:00Z).
      await outbound.enqueue({
        ...baseEnqueue,
        scheduledFor: new Date('2026-09-09T09:00:00.000Z'),
      });

      expect(created().scheduledFor.toISOString()).toBe(
        '2026-09-09T11:00:00.000Z',
      );
      expect(created().status).toBeUndefined(); // segue pendente
    });

    it('depois do fechamento, adia para a manhã seguinte', async () => {
      // 22:00 em SP → 08:00 do dia seguinte.
      await outbound.enqueue({
        ...baseEnqueue,
        scheduledFor: new Date('2026-09-10T01:00:00.000Z'),
      });

      expect(created().scheduledFor.toISOString()).toBe(
        '2026-09-10T11:00:00.000Z',
      );
    });

    it('feriado empurra para o próximo dia útil', async () => {
      holidaysMock.isHoliday
        .mockResolvedValueOnce(true) // o dia pedido é feriado
        .mockResolvedValue(false);

      await outbound.enqueue(baseEnqueue);

      expect(created().scheduledFor.toISOString()).toBe(
        '2026-09-10T11:00:00.000Z',
      );
    });

    it('o que perde o sentido adiado é suprimido em vez de enviado atrasado', async () => {
      // "Sua consulta é daqui a 1 hora" empurrado para o dia seguinte chega
      // depois do fato — pior do que não enviar.
      const result = await outbound.enqueue({
        ...baseEnqueue,
        kind: 'lembrete_1h',
        scheduledFor: new Date('2026-09-10T01:00:00.000Z'), // 22:00 em SP
      });

      expect(result).toBe('suprimido');
      expect(created()).toMatchObject({ reason: 'fora_da_janela' });
    });

    it('um lembrete de 3 dias, esse sim, aceita esperar a manhã', async () => {
      const result = await outbound.enqueue({
        ...baseEnqueue,
        kind: 'lembrete_3d',
        scheduledFor: new Date('2026-09-10T01:00:00.000Z'),
      });
      expect(result).toBe('criado');
    });
  });

  describe('dispatchDue — envio', () => {
    const pending = {
      id: 'msg-1',
      clinicId: CLINIC,
      kind: 'lembrete_1d' as const,
      dedupeKey: 'lembrete_1d:x:1',
      body: 'Olá, Marina!',
      phone: '5511999998888',
      conversationId: CONVERSATION,
      appointmentId: null,
      createdAt: new Date('2026-09-08T13:00:00.000Z'),
      retries: 0,
    };

    it('envia, registra na conversa e marca como enviado', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([pending]);

      const summary = await outbound.dispatchDue(NOW);

      expect(summary.enviados).toBe(1);
      expect(evolutionMock.sendText).toHaveBeenCalledWith(
        'dentaltrack',
        '5511999998888',
        'Olá, Marina!',
      );
      // A mensagem entra na conversa: é isso que faz a resposta do cliente cair
      // no mesmo fio e o agente assumir dali.
      expect(conversationsMock.appendMessage).toHaveBeenCalledWith(
        CONVERSATION,
        'assistant',
        'Olá, Marina!',
        {},
        CLINIC,
      );
      expect(prismaMock.outboundMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-1' },
          data: expect.objectContaining({ status: 'enviado' }),
        }),
      );
    });

    it('abre uma conversa quando a mensagem ainda não tem uma', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...pending, conversationId: null },
      ]);
      conversationsMock.resolveByPhone.mockResolvedValueOnce({ id: 'nova' });

      await outbound.dispatchDue(NOW);

      expect(conversationsMock.resolveByPhone).toHaveBeenCalledWith(
        CLINIC,
        'whatsapp',
        '5511999998888',
      );
      expect(conversationsMock.appendMessage).toHaveBeenCalledWith(
        'nova',
        'assistant',
        expect.any(String),
        {},
        CLINIC,
      );
    });

    it('respeita o teto diário da empresa', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([pending]);
      prismaMock.outboundMessage.count.mockResolvedValueOnce(
        DEFAULT_AUTOMATION_SETTINGS.dailyCap,
      );

      const summary = await outbound.dispatchDue(NOW);

      expect(summary.suprimidos).toBe(1);
      expect(evolutionMock.sendText).not.toHaveBeenCalled();
      expect(prismaMock.outboundMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'suprimido', reason: 'teto_diario' },
        }),
      );
    });

    it('falha de transporte reagenda antes de desistir', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([pending]);
      evolutionMock.sendText.mockRejectedValueOnce(new Error('Evolution 500'));

      const summary = await outbound.dispatchDue(NOW);

      expect(summary.falhas).toBe(1);
      const data = prismaMock.outboundMessage.update.mock.calls[0][0].data;
      expect(data.retries).toEqual({ increment: 1 });
      expect(data.status).toBeUndefined(); // continua pendente
    });

    it('esgotadas as tentativas, marca como falhou', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...pending, retries: 2 },
      ]);
      evolutionMock.sendText.mockRejectedValueOnce(new Error('Evolution 500'));

      await outbound.dispatchDue(NOW);

      expect(
        prismaMock.outboundMessage.update.mock.calls[0][0].data,
      ).toMatchObject({ status: 'falhou' });
    });
  });

  describe('dispatchDue — revalidação na hora do envio', () => {
    const startsAt = new Date('2026-09-10T13:00:00.000Z');
    const reminder = {
      id: 'msg-2',
      clinicId: CLINIC,
      kind: 'lembrete_1d' as const,
      dedupeKey: reminderKey('lembrete_1d', APPOINTMENT, startsAt),
      body: 'Olá!',
      phone: '5511999998888',
      conversationId: CONVERSATION,
      appointmentId: APPOINTMENT,
      createdAt: new Date('2026-09-08T13:00:00.000Z'),
      retries: 0,
    };

    const expectSuppressed = (reason: string) => {
      expect(evolutionMock.sendText).not.toHaveBeenCalled();
      expect(prismaMock.outboundMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'suprimido', reason } }),
      );
    };

    it('consulta cancelada entre o planejamento e o envio', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([reminder]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'cancelado',
        startsAt,
      });

      await outbound.dispatchDue(NOW);
      expectSuppressed('agendamento_mudou');
    });

    it('consulta remarcada: a chave não bate mais com o horário atual', async () => {
      // Remarcação se resolve sozinha: o planejador enfileira o lembrete novo
      // com a chave nova, e o velho morre aqui.
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([reminder]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'agendado',
        startsAt: new Date('2026-09-11T13:00:00.000Z'),
      });

      await outbound.dispatchDue(NOW);
      expectSuppressed('agendamento_mudou');
    });

    it('aviso de atraso não sai para quem já foi atendido', async () => {
      // O pior erro possível desta automação: avisar de atraso quem já está na
      // cadeira.
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...reminder, kind: 'atraso', dedupeKey: `atraso:${APPOINTMENT}:1` },
      ]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'compareceu',
        startsAt,
      });

      await outbound.dispatchDue(NOW);
      expectSuppressed('agendamento_mudou');
    });

    it('a cadência de falta para na primeira resposta do cliente', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...reminder, kind: 'falta', dedupeKey: `falta:${APPOINTMENT}:2` },
      ]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'faltou',
        startsAt,
      });
      prismaMock.message.findFirst.mockResolvedValueOnce({ id: 'reply' });

      await outbound.dispatchDue(NOW);
      expectSuppressed('cliente_respondeu');
    });

    it('descadastro pedido depois do enfileiramento é respeitado', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([
        { ...reminder, appointmentId: null },
      ]);
      optOutMock.isOptedOut.mockResolvedValueOnce(true);

      await outbound.dispatchDue(NOW);
      expectSuppressed('opt_out');
    });

    it('sem nada de errado, o lembrete sai', async () => {
      prismaMock.outboundMessage.findMany.mockResolvedValueOnce([reminder]);
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        status: 'agendado',
        startsAt,
      });

      const summary = await outbound.dispatchDue(NOW);
      expect(summary.enviados).toBe(1);
    });
  });
});
