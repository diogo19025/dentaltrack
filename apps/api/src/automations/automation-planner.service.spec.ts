import { Test } from '@nestjs/testing';
import {
  type AutomationSettings,
  DEFAULT_AUTOMATION_SETTINGS,
} from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  AutomationPlannerService,
  matchesRecallProcedure,
} from './automation-planner.service';
import { AutomationSettingsService } from './automation-settings.service';
import { OutboundService } from './outbound.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const APPOINTMENT = '33333333-3333-3333-3333-333333333333';
const CONVERSATION = '22222222-2222-2222-2222-222222222222';
const LEAD = '44444444-4444-4444-4444-444444444444';

/** Quarta-feira, 09/09/2026, 10:00 em São Paulo. */
const NOW = new Date('2026-09-09T13:00:00.000Z');

/** Linha de agendamento como o `findMany` do planejador a seleciona. */
function appointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APPOINTMENT,
    startsAt: new Date('2026-09-12T13:00:00.000Z'), // +3 dias
    professionalName: 'Dra. Ana',
    conversationId: CONVERSATION,
    leadId: LEAD,
    procedure: { name: 'Manutenção' },
    notes: null,
    lead: { name: 'Marina Alves', phone: '5511999998888' },
    clinic: { name: 'Clínica Teste' },
    ...overrides,
  };
}

describe('AutomationPlannerService (o que precisa ser enviado · F9)', () => {
  let planner: AutomationPlannerService;

  const prismaMock = {
    appointment: { findMany: jest.fn(), findFirst: jest.fn() },
    outboundMessage: { findMany: jest.fn(), findFirst: jest.fn() },
    message: { findFirst: jest.fn() },
    clinicSettings: { findMany: jest.fn() },
  };
  const settingsMock = { get: jest.fn() };
  const outboundMock = { enqueue: jest.fn() };

  const withSettings = (overrides: Partial<AutomationSettings> = {}) => {
    settingsMock.get.mockResolvedValue({
      ...DEFAULT_AUTOMATION_SETTINGS,
      ...overrides,
    });
  };

  /** Só a automação sob teste ligada — isola o que cada bloco verifica. */
  const onlyRule = (rule: keyof AutomationSettings) => {
    const off = { enabled: false };
    withSettings({
      lembrete3d: { ...DEFAULT_AUTOMATION_SETTINGS.lembrete3d, ...off },
      lembrete1d: { ...DEFAULT_AUTOMATION_SETTINGS.lembrete1d, ...off },
      lembrete1h: { ...DEFAULT_AUTOMATION_SETTINGS.lembrete1h, ...off },
      atraso: { ...DEFAULT_AUTOMATION_SETTINGS.atraso, ...off },
      falta: { ...DEFAULT_AUTOMATION_SETTINGS.falta, ...off },
      retorno: { ...DEFAULT_AUTOMATION_SETTINGS.retorno, ...off },
      [rule]: {
        ...(DEFAULT_AUTOMATION_SETTINGS[rule] as object),
        enabled: true,
      },
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    withSettings();
    outboundMock.enqueue.mockResolvedValue('criado');
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.appointment.findFirst.mockResolvedValue(null);
    prismaMock.outboundMessage.findMany.mockResolvedValue([]);
    prismaMock.outboundMessage.findFirst.mockResolvedValue(null);
    prismaMock.message.findFirst.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AutomationPlannerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AutomationSettingsService, useValue: settingsMock },
        { provide: OutboundService, useValue: outboundMock },
      ],
    }).compile();
    planner = moduleRef.get(AutomationPlannerService);
  });

  const enqueuedKinds = () =>
    outboundMock.enqueue.mock.calls.map((call) => call[0].kind);
  const enqueuedOf = (kind: string) =>
    outboundMock.enqueue.mock.calls.find((call) => call[0].kind === kind)?.[0];

  describe('① lembretes', () => {
    it('enfileira os três lembretes de uma consulta em 3 dias', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([appointmentRow()]);

      await planner.planForClinic(CLINIC, NOW);

      expect(enqueuedKinds()).toEqual(
        expect.arrayContaining(['lembrete_3d', 'lembrete_1d', 'lembrete_1h']),
      );
      // Cada um marcado para o seu antecedente exato.
      expect(enqueuedOf('lembrete_1h').scheduledFor.toISOString()).toBe(
        '2026-09-12T12:00:00.000Z',
      );
      expect(enqueuedOf('lembrete_1d').scheduledFor.toISOString()).toBe(
        '2026-09-11T13:00:00.000Z',
      );
    });

    it('a chave carrega o horário da consulta (remarcação se resolve sozinha)', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([appointmentRow()]);

      await planner.planForClinic(CLINIC, NOW);

      const key = enqueuedOf('lembrete_1d').dedupeKey;
      expect(key).toContain('lembrete_1d');
      expect(key).toContain(APPOINTMENT);
      expect(key).toMatch(/:\d+$/);
    });

    it('preenche o texto com nome, empresa, data e hora', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([appointmentRow()]);

      await planner.planForClinic(CLINIC, NOW);

      const body = enqueuedOf('lembrete_1d').body as string;
      expect(body).toContain('Marina'); // primeiro nome, não o completo
      expect(body).not.toContain('Marina Alves');
      expect(body).toContain('Clínica Teste');
      expect(body).toContain('10:00');
      expect(body).not.toMatch(/\{\w+\}/); // nenhum marcador cru vaza
    });

    it('pula o lembrete cujo momento já passou', async () => {
      // Consulta marcada em cima da hora: "faltam 3 dias" não faz mais sentido,
      // mas o de 1 hora ainda sim.
      onlyRule('lembrete3d');
      prismaMock.appointment.findMany.mockResolvedValue([
        appointmentRow({ startsAt: new Date('2026-09-10T13:00:00.000Z') }),
      ]);

      await planner.planForClinic(CLINIC, NOW);

      expect(outboundMock.enqueue).not.toHaveBeenCalled();
    });

    it('regra desligada não enfileira nada', async () => {
      withSettings({
        lembrete3d: { enabled: false, template: 'x' },
        lembrete1d: { enabled: false, template: 'x' },
        lembrete1h: { enabled: false, template: 'x' },
        atraso: { ...DEFAULT_AUTOMATION_SETTINGS.atraso, enabled: false },
        falta: { ...DEFAULT_AUTOMATION_SETTINGS.falta, enabled: false },
        retorno: { ...DEFAULT_AUTOMATION_SETTINGS.retorno, enabled: false },
      });
      prismaMock.appointment.findMany.mockResolvedValue([appointmentRow()]);

      await planner.planForClinic(CLINIC, NOW);

      expect(outboundMock.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('② atraso', () => {
    beforeEach(() => {
      onlyRule('atraso');
      withSettings({
        lembrete3d: { enabled: false, template: 'x' },
        lembrete1d: { enabled: false, template: 'x' },
        lembrete1h: { enabled: false, template: 'x' },
        falta: { ...DEFAULT_AUTOMATION_SETTINGS.falta, enabled: false },
        retorno: { ...DEFAULT_AUTOMATION_SETTINGS.retorno, enabled: false },
        atraso: { ...DEFAULT_AUTOMATION_SETTINGS.atraso, enabled: true },
      });
    });

    it('só alcança agendamentos vindos da integração', async () => {
      // Trava deliberada: um agendamento criado pelo bot nunca recebe "chegou",
      // então sem esta restrição todo mundo levaria aviso de atraso indevido.
      await planner.planForClinic(CLINIC, NOW);

      const where = prismaMock.appointment.findMany.mock.calls[0][0].where;
      expect(where.source).toBe('integracao');
      expect(where.status).toEqual({ in: ['agendado', 'confirmado'] });
    });

    it('dispara em horário da consulta + tolerância', async () => {
      const startsAt = new Date(NOW.getTime() - 20 * 60_000);
      prismaMock.appointment.findMany.mockResolvedValue([
        appointmentRow({ startsAt }),
      ]);

      await planner.planForClinic(CLINIC, NOW);

      const enqueued = enqueuedOf('atraso');
      expect(enqueued.scheduledFor.toISOString()).toBe(
        new Date(startsAt.getTime() + 15 * 60_000).toISOString(),
      );
    });
  });

  describe('③ falta — cadência com teto', () => {
    beforeEach(() => {
      withSettings({
        lembrete3d: { enabled: false, template: 'x' },
        lembrete1d: { enabled: false, template: 'x' },
        lembrete1h: { enabled: false, template: 'x' },
        atraso: { ...DEFAULT_AUTOMATION_SETTINGS.atraso, enabled: false },
        retorno: { ...DEFAULT_AUTOMATION_SETTINGS.retorno, enabled: false },
        falta: {
          ...DEFAULT_AUTOMATION_SETTINGS.falta,
          enabled: true,
          attempts: 2,
          intervalHours: 48,
        },
      });
    });

    const missed = () =>
      appointmentRow({ startsAt: new Date('2026-09-08T12:00:00.000Z') });

    it('primeira tentativa duas horas depois da falta', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([missed()]);

      await planner.planForClinic(CLINIC, NOW);

      const enqueued = enqueuedOf('falta');
      expect(enqueued.attempt).toBe(1);
      expect(enqueued.dedupeKey).toBe(`falta:${APPOINTMENT}:1`);
    });

    it('não avança enquanto o intervalo não fecha', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([missed()]);
      prismaMock.outboundMessage.findMany.mockResolvedValue([
        {
          attempt: 1,
          status: 'enviado',
          sentAt: new Date(NOW.getTime() - 3_600_000),
          reason: null,
        },
      ]);

      await planner.planForClinic(CLINIC, NOW);

      expect(outboundMock.enqueue).not.toHaveBeenCalled();
    });

    it('fechado o intervalo e sem resposta, tenta de novo', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([missed()]);
      prismaMock.outboundMessage.findMany.mockResolvedValue([
        {
          attempt: 1,
          status: 'enviado',
          sentAt: new Date(NOW.getTime() - 50 * 3_600_000),
          reason: null,
        },
      ]);

      await planner.planForClinic(CLINIC, NOW);

      expect(enqueuedOf('falta').attempt).toBe(2);
    });

    it('o cliente respondeu: a cadência para', async () => {
      // O limite entre retomar o contato e perseguir.
      prismaMock.appointment.findMany.mockResolvedValue([missed()]);
      prismaMock.outboundMessage.findMany.mockResolvedValue([
        {
          attempt: 1,
          status: 'enviado',
          sentAt: new Date(NOW.getTime() - 50 * 3_600_000),
          reason: null,
        },
      ]);
      prismaMock.message.findFirst.mockResolvedValue({ id: 'reply' });

      await planner.planForClinic(CLINIC, NOW);

      expect(outboundMock.enqueue).not.toHaveBeenCalled();
    });

    it('o teto de tentativas é rígido', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([missed()]);
      prismaMock.outboundMessage.findMany.mockResolvedValue([
        {
          attempt: 2,
          status: 'enviado',
          sentAt: new Date(NOW.getTime() - 100 * 3_600_000),
          reason: null,
        },
      ]);

      await planner.planForClinic(CLINIC, NOW);

      expect(outboundMock.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('④ retorno de manutenção', () => {
    beforeEach(() => {
      withSettings({
        lembrete3d: { enabled: false, template: 'x' },
        lembrete1d: { enabled: false, template: 'x' },
        lembrete1h: { enabled: false, template: 'x' },
        atraso: { ...DEFAULT_AUTOMATION_SETTINGS.atraso, enabled: false },
        falta: { ...DEFAULT_AUTOMATION_SETTINGS.falta, enabled: false },
        retorno: { ...DEFAULT_AUTOMATION_SETTINGS.retorno, enabled: true },
      });
    });

    const attended = (procedureName: string) =>
      appointmentRow({
        startsAt: new Date('2026-08-09T13:00:00.000Z'), // 31 dias atrás
        procedure: { name: procedureName },
      });

    it('procura atendimentos concluídos na data-alvo', async () => {
      await planner.planForClinic(CLINIC, NOW);

      const where = prismaMock.appointment.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('compareceu');
    });

    it('enfileira quem fez manutenção e não deixou a próxima marcada', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([
        attended('Manutenção periódica'),
      ]);

      await planner.planForClinic(CLINIC, NOW);

      expect(enqueuedOf('retorno').dedupeKey).toBe(`retorno:${APPOINTMENT}`);
    });

    it('não incomoda quem já tem consulta futura marcada', async () => {
      // É o ponto exato do pedido: só quem "saiu sem deixar a próxima marcada".
      prismaMock.appointment.findMany.mockResolvedValue([
        attended('Manutenção'),
      ]);
      prismaMock.appointment.findFirst.mockResolvedValue({ id: 'futura' });

      await planner.planForClinic(CLINIC, NOW);

      expect(outboundMock.enqueue).not.toHaveBeenCalled();
    });

    it('ignora procedimento que não é manutenção', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([
        attended('Clareamento'),
      ]);

      await planner.planForClinic(CLINIC, NOW);

      expect(outboundMock.enqueue).not.toHaveBeenCalled();
    });

    it('não repete o retorno para quem já recebeu um há pouco', async () => {
      prismaMock.appointment.findMany.mockResolvedValue([
        attended('Manutenção'),
      ]);
      prismaMock.outboundMessage.findFirst.mockResolvedValue({
        id: 'anterior',
      });

      await planner.planForClinic(CLINIC, NOW);

      expect(outboundMock.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('planAll', () => {
    it('percorre só as empresas com WhatsApp conectado', async () => {
      prismaMock.clinicSettings.findMany.mockResolvedValue([
        { clinicId: CLINIC },
      ]);

      await planner.planAll(NOW);

      expect(prismaMock.clinicSettings.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { whatsappInstance: { not: null } },
        }),
      );
    });

    it('falha de uma empresa não derruba as outras', async () => {
      prismaMock.clinicSettings.findMany.mockResolvedValue([
        { clinicId: 'a' },
        { clinicId: CLINIC },
      ]);
      settingsMock.get
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue({ ...DEFAULT_AUTOMATION_SETTINGS });

      await expect(planner.planAll(NOW)).resolves.toBeDefined();
      expect(settingsMock.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('matchesRecallProcedure', () => {
    const keywords = ['manutenção', 'limpeza'];

    it('casa sem acento, sem caixa e como parte do nome', () => {
      expect(
        matchesRecallProcedure(
          { procedureName: 'MANUTENCAO PERIODICA' },
          keywords,
        ),
      ).toBe(true);
      expect(
        matchesRecallProcedure({ procedureName: 'Limpeza dental' }, keywords),
      ).toBe(true);
    });

    it('não casa procedimento diferente nem lista vazia', () => {
      expect(
        matchesRecallProcedure({ procedureName: 'Clareamento' }, keywords),
      ).toBe(false);
      expect(matchesRecallProcedure({ procedureName: null }, keywords)).toBe(
        false,
      );
      expect(matchesRecallProcedure({ procedureName: 'Manutenção' }, [])).toBe(
        false,
      );
    });
  });
});
