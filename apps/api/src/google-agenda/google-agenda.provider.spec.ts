import type { GoogleAgendaConfig } from '@dentaltrack/shared';
import {
  GOOGLE_PROFESSIONAL_ID,
  GoogleAgendaProvider,
} from './google-agenda.provider';
import type { GoogleCalendarClient } from './google-calendar.client';

const TZ = 'America/Sao_Paulo';
/** Terça-feira, 2026-09-01, 08:00 no fuso da empresa (-03:00). */
const NOW = new Date('2026-09-01T11:00:00.000Z');

const config: GoogleAgendaConfig = {
  calendarId: 'clinica@group.calendar.google.com',
  workStart: '09:00',
  workEnd: '12:00',
  workDays: [1, 2, 3, 4, 5],
  slotMinutes: 30,
};

describe('GoogleAgendaProvider (Google Agenda atrás da porta · F12)', () => {
  const clientMock = {
    getCalendar: jest.fn(),
    freeBusy: jest.fn(),
    listEvents: jest.fn(),
    createEvent: jest.fn(),
  };

  const provider = new GoogleAgendaProvider(
    clientMock as unknown as GoogleCalendarClient,
    TZ,
    config,
    () => NOW,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    clientMock.freeBusy.mockResolvedValue([]);
  });

  describe('listUnits / listProfessionals — a agenda é a unidade', () => {
    it('devolve a própria agenda como unidade, validando o compartilhamento', async () => {
      clientMock.getCalendar.mockResolvedValue({
        summary: 'Agenda da Clínica',
      });

      const units = await provider.listUnits();

      expect(units).toEqual([
        { id: config.calendarId, name: 'Agenda da Clínica' },
      ]);
    });

    it('devolve um profissional sintético — o Google agenda por calendário', async () => {
      clientMock.getCalendar.mockResolvedValue({
        summary: 'Agenda da Clínica',
      });

      const professionals = await provider.listProfessionals();

      expect(professionals).toHaveLength(1);
      expect(professionals[0].id).toBe(GOOGLE_PROFESSIONAL_ID);
    });
  });

  describe('listAvailableSlots — janela de trabalho menos free/busy', () => {
    const window = {
      from: NOW,
      to: new Date('2026-09-02T21:00:00.000Z'),
    };

    it('gera a grade do expediente e pula o que o free/busy diz estar ocupado', async () => {
      // 10:00–11:00 locais ocupados na terça.
      clientMock.freeBusy.mockResolvedValue([
        {
          start: new Date('2026-09-01T13:00:00.000Z'),
          end: new Date('2026-09-01T14:00:00.000Z'),
        },
      ]);

      const slots = await provider.listAvailableSlots(window);
      const tuesday = slots.filter((s) => s.startsAt.startsWith('2026-09-01'));

      expect(tuesday.map((s) => s.startsAt)).toEqual([
        '2026-09-01T12:00:00.000Z', // 09:00 local
        '2026-09-01T12:30:00.000Z', // 09:30
        '2026-09-01T14:00:00.000Z', // 11:00 — 10:00/10:30 caíram no ocupado
        '2026-09-01T14:30:00.000Z', // 11:30 (termina 12:00, ainda dentro)
      ]);
      expect(tuesday[0].professionalId).toBe(GOOGLE_PROFESSIONAL_ID);
      expect(tuesday[0].unitId).toBe(config.calendarId);
    });

    it('duração maior que a grade encolhe os inícios possíveis', async () => {
      const slots = await provider.listAvailableSlots({
        ...window,
        durationMinutes: 60,
      });
      const tuesday = slots.filter((s) => s.startsAt.startsWith('2026-09-01'));

      // Último início possível é 11:00 (termina 12:00).
      expect(tuesday.at(-1)?.startsAt).toBe('2026-09-01T14:00:00.000Z');
    });

    it('não oferece horário no passado nem fora dos dias de atendimento', async () => {
      const sundayProvider = new GoogleAgendaProvider(
        clientMock as unknown as GoogleCalendarClient,
        TZ,
        { ...config, workDays: [0] }, // só domingo
        () => NOW,
      );

      const slots = await sundayProvider.listAvailableSlots(window);
      expect(slots).toEqual([]); // a janela pedida só tem terça e quarta
    });

    it('respeita o limite pedido (o agente oferece um punhado por vez)', async () => {
      const slots = await provider.listAvailableSlots({ ...window, limit: 3 });
      expect(slots).toHaveLength(3);
    });
  });

  describe('listAppointments — eventos viram agendamentos normalizados', () => {
    it('lê os nossos pelas propriedades e os alheios pelo título; ignora dia inteiro', async () => {
      clientMock.listEvents.mockResolvedValue([
        {
          id: 'evt-nosso',
          status: 'confirmed',
          summary: 'Avaliação — Marina Alves',
          start: { dateTime: '2026-09-01T14:00:00.000Z' },
          end: { dateTime: '2026-09-01T14:30:00.000Z' },
          extendedProperties: {
            private: {
              dentaltrack: '1',
              dentaltrackPatientName: 'Marina Alves',
              dentaltrackPatientPhone: '5511999990001',
              dentaltrackProcedure: 'Avaliação',
            },
          },
        },
        {
          id: 'evt-recepcao',
          status: 'confirmed',
          summary: 'Rafael Nogueira',
          start: { dateTime: '2026-09-01T15:00:00.000Z' },
          end: { dateTime: '2026-09-01T15:30:00.000Z' },
        },
        {
          id: 'evt-cancelado',
          status: 'cancelled',
          start: { dateTime: '2026-09-01T16:00:00.000Z' },
        },
        // Dia inteiro (feriado, bloqueio) não é um agendamento.
        {
          id: 'evt-dia-inteiro',
          status: 'confirmed',
          start: { date: '2026-09-01' },
        },
      ]);

      const appointments = await provider.listAppointments({
        from: NOW,
        to: new Date('2026-09-02T00:00:00.000Z'),
      });

      expect(appointments.map((a) => a.externalId)).toEqual([
        'evt-nosso',
        'evt-recepcao',
        'evt-cancelado',
      ]);
      expect(appointments[0].patientName).toBe('Marina Alves');
      expect(appointments[0].patientPhone).toBe('5511999990001');
      expect(appointments[0].procedureName).toBe('Avaliação');
      expect(appointments[1].patientName).toBe('Rafael Nogueira');
      expect(appointments[2].statusExternalId).toBe('cancelled');
      expect(appointments[2].statusName).toContain('Cancelado');
    });
  });

  describe('pacientes — o Google não tem cadastro', () => {
    it('findPatient nunca acha; createPatient devolve id vazio de propósito', async () => {
      expect(await provider.findPatient({ phone: '5511999990001' })).toBeNull();
      const patient = await provider.createPatient({ name: 'Marina' });
      // Id vazio impede que um id inventado acabe gravado em lead.externalId.
      expect(patient.id).toBe('');
    });
  });

  describe('createAppointment', () => {
    it('cria o evento com os dados do paciente nas propriedades e devolve o id', async () => {
      clientMock.createEvent.mockResolvedValue({
        id: 'evt-novo',
        status: 'confirmed',
        summary: 'Avaliação — Marina Alves',
        start: { dateTime: '2026-09-03T14:00:00.000Z' },
        end: { dateTime: '2026-09-03T14:30:00.000Z' },
        extendedProperties: {
          private: { dentaltrack: '1', dentaltrackPatientName: 'Marina Alves' },
        },
      });

      const created = await provider.createAppointment({
        patientId: null,
        patientName: 'Marina Alves',
        patientPhone: '5511999990001',
        startsAt: new Date('2026-09-03T14:00:00.000Z'),
        endsAt: new Date('2026-09-03T14:30:00.000Z'),
        unitId: config.calendarId,
        professionalId: GOOGLE_PROFESSIONAL_ID,
        procedureName: 'Avaliação',
      });

      expect(created.externalId).toBe('evt-novo');
      const [calendarId, body] = clientMock.createEvent.mock.calls[0];
      expect(calendarId).toBe(config.calendarId);
      expect(body.summary).toBe('Avaliação — Marina Alves');
      expect(body.extendedProperties.private.dentaltrackPatientPhone).toBe(
        '5511999990001',
      );
    });

    it('sem id externo confirmado, lança — nunca "sucesso vazio"', async () => {
      clientMock.createEvent.mockResolvedValue({});

      await expect(
        provider.createAppointment({
          patientId: null,
          patientName: 'Marina Alves',
          patientPhone: null,
          startsAt: new Date('2026-09-03T14:00:00.000Z'),
          endsAt: new Date('2026-09-03T14:30:00.000Z'),
          unitId: config.calendarId,
          professionalId: GOOGLE_PROFESSIONAL_ID,
          procedureName: null,
        }),
      ).rejects.toThrow('não devolveu');
    });
  });
});
