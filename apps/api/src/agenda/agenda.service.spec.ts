import {
  AgendaProviderError,
  AgendaSlotReleasedError,
} from '../clinicorp/agenda-provider';
import { AgendaService, type BookInput } from './agenda.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';

/**
 * Relógio congelado — as datas dos cenários são fixas (outubro de 2026) e o
 * `reschedule` recusa horário no passado consultando `Date.now()`. Sem congelar,
 * este arquivo passaria a falhar sozinho em 02/10/2026, sem ninguém ter mexido
 * em nada. Ver a mesma armadilha em `outbound.service.spec.ts`.
 */
const NOW = new Date('2026-09-09T13:00:00.000Z');

beforeAll(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
});

afterAll(() => {
  jest.restoreAllMocks();
});

/** Erro do Prisma para violação de índice único. */
const p2002 = () =>
  Object.assign(new Error('Unique constraint'), { code: 'P2002' });

function setup(options: { provider?: unknown } = {}) {
  const prisma = {
    appointment: {
      create: jest.fn().mockResolvedValue({ id: 'apt-1' }),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
    },
    lead: { update: jest.fn().mockResolvedValue({}) },
  };
  const integrations = {
    getProvider: jest.fn().mockResolvedValue(options.provider ?? null),
    activeStatus: jest
      .fn()
      .mockResolvedValue({ unitId: 'u1', professionalId: 'p1' }),
    timeZoneOf: jest.fn().mockResolvedValue('America/Sao_Paulo'),
  };
  const service = new AgendaService(prisma as never, integrations as never);
  // O logger grita nos caminhos de falha, que são exatamente os que testamos.
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  return { service, prisma, integrations };
}

function providerMock(overrides: Record<string, unknown> = {}) {
  return {
    live: true,
    findPatient: jest.fn().mockResolvedValue({ id: 'pac-1' }),
    createPatient: jest.fn().mockResolvedValue({ id: 'pac-1' }),
    createAppointment: jest.fn().mockResolvedValue({
      externalId: 'ext-9',
      professionalName: 'Dra. Ana',
    }),
    listUnits: jest.fn().mockResolvedValue([{ id: 'u1' }]),
    listProfessionals: jest.fn().mockResolvedValue([{ id: 'p1' }]),
    // Lista vazia = fail-open (segue e cria); os testes de conflito sobrepõem.
    listAvailableSlots: jest.fn().mockResolvedValue([]),
    cancelAppointment: jest.fn().mockResolvedValue(undefined),
    rescheduleAppointment: jest.fn().mockResolvedValue({
      externalId: 'ext-9',
      professionalName: 'Dra. Ana',
    }),
    ...overrides,
  };
}

/** Linha como `requireAppointment` a lê (cancelar/remarcar). */
function appointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apt-1',
    status: 'agendado',
    startsAt: new Date('2026-10-01T13:00:00.000Z'),
    endsAt: new Date('2026-10-01T14:00:00.000Z'),
    externalId: 'ext-9',
    unitExternalId: 'u1',
    professionalExternalId: 'p1',
    professionalName: 'Dra. Ana',
    notes: 'Implante',
    procedure: { name: 'Implante', durationMinutes: 60 },
    lead: { name: 'Ana Silva', phone: '5511987654321', externalId: 'pac-1' },
    ...overrides,
  };
}

/** Linha como `summaryOf` a lê (projeção para a tela). */
function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apt-1',
    status: 'agendado',
    source: 'integracao',
    startsAt: new Date('2026-10-01T13:00:00.000Z'),
    endsAt: new Date('2026-10-01T14:00:00.000Z'),
    preferredTime: null,
    professionalName: 'Dra. Ana',
    externalId: 'ext-9',
    canceledAt: null,
    createdAt: new Date('2026-09-09T12:00:00.000Z'),
    conversationId: 'conv-1',
    leadId: 'lead-1',
    procedure: { name: 'Implante' },
    notes: 'Implante',
    lead: { name: 'Ana Silva', phone: '5511987654321' },
    ...overrides,
  };
}

const INPUT: BookInput = {
  conversationId: 'conv-1',
  leadId: 'lead-1',
  procedureId: 'proc-1',
  procedureName: 'Implante',
  durationMinutes: 60,
  startsAt: new Date('2026-10-01T13:00:00.000Z'),
  preferredTime: null,
  patientName: 'Ana Silva',
  patientPhone: '5511987654321',
};

describe('AgendaService.book', () => {
  describe('ordem das escritas (P0.5)', () => {
    // A propriedade central: se a chamada externa falhar, o pedido do cliente
    // já está salvo — e não há como o retry criar um segundo.
    it('grava o pedido local ANTES de chamar a agenda externa', async () => {
      const provider = providerMock();
      const { service, prisma } = setup({ provider });
      const ordem: string[] = [];
      prisma.appointment.create.mockImplementation(() => {
        ordem.push('local');
        return Promise.resolve({ id: 'apt-1' });
      });
      provider.createAppointment.mockImplementation(() => {
        ordem.push('externo');
        return Promise.resolve({ externalId: 'ext-9', professionalName: null });
      });

      await service.book(CLINIC, INPUT);

      expect(ordem).toEqual(['local', 'externo']);
    });

    it('grava a bookingKey na linha local', async () => {
      const { service, prisma } = setup();
      await service.book(CLINIC, INPUT);
      expect(
        prisma.appointment.create.mock.calls[0][0].data.bookingKey,
      ).toMatch(/^[0-9a-f]{32}$/);
    });

    it('reconcilia a MESMA linha com o id externo, sem criar outra', async () => {
      const provider = providerMock();
      const { service, prisma } = setup({ provider });

      const res = await service.book(CLINIC, INPUT);

      expect(prisma.appointment.create).toHaveBeenCalledTimes(1);
      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'apt-1' },
        data: {
          externalId: 'ext-9',
          professionalName: 'Dra. Ana',
          source: 'integracao',
        },
      });
      expect(res).toMatchObject({ confirmed: true, externalId: 'ext-9' });
    });
  });

  describe('repetição da mesma operação', () => {
    // Duplo clique, retry após timeout, webhook reentregue e o modelo chamando
    // a tool duas vezes no mesmo turno caem todos aqui.
    it('devolve o agendamento existente e NÃO chama a agenda externa de novo', async () => {
      const provider = providerMock();
      const { service, prisma } = setup({ provider });
      prisma.appointment.create.mockRejectedValueOnce(p2002());
      prisma.appointment.findFirst.mockResolvedValueOnce({
        id: 'apt-ja-existe',
        startsAt: INPUT.startsAt,
        source: 'integracao',
        externalId: 'ext-9',
      });

      const res = await service.book(CLINIC, INPUT);

      expect(res).toEqual({
        appointmentId: 'apt-ja-existe',
        startsAt: INPUT.startsAt,
        confirmed: true,
        externalId: 'ext-9',
        failureKind: null,
      });
      expect(provider.createAppointment).not.toHaveBeenCalled();
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('duas chamadas idênticas produzem uma linha só', async () => {
      const provider = providerMock();
      const { service, prisma } = setup({ provider });
      prisma.appointment.create
        .mockResolvedValueOnce({ id: 'apt-1' })
        .mockRejectedValueOnce(p2002());
      prisma.appointment.findFirst.mockResolvedValue({
        id: 'apt-1',
        startsAt: INPUT.startsAt,
        source: 'integracao',
        externalId: 'ext-9',
      });

      const primeira = await service.book(CLINIC, INPUT);
      const segunda = await service.book(CLINIC, INPUT);

      expect(segunda.appointmentId).toBe(primeira.appointmentId);
      expect(provider.createAppointment).toHaveBeenCalledTimes(1);
    });

    it('propaga o erro se a colisão não tiver linha correspondente', async () => {
      const { service, prisma } = setup();
      prisma.appointment.create.mockRejectedValueOnce(p2002());
      prisma.appointment.findFirst.mockResolvedValueOnce(null);

      await expect(service.book(CLINIC, INPUT)).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('não engole erro que não seja violação de unicidade', async () => {
      const { service, prisma } = setup();
      prisma.appointment.create.mockRejectedValueOnce(new Error('banco fora'));
      await expect(service.book(CLINIC, INPUT)).rejects.toThrow('banco fora');
    });

    // Sem identidade de contato não há chave; nulo não colide com nulo, então
    // essas linhas seguem independentes — e o P2002 não pode ser interpretado
    // como "já existe".
    it('sem chave, uma colisão não vira reaproveitamento', async () => {
      const { service, prisma } = setup();
      prisma.appointment.create.mockRejectedValueOnce(p2002());

      await expect(
        service.book(CLINIC, {
          ...INPUT,
          conversationId: null,
          leadId: null,
          patientPhone: null,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('falha da agenda externa', () => {
    it('mantém o pedido registrado com confirmed: false, sem órfão', async () => {
      const provider = providerMock({
        createAppointment: jest.fn().mockRejectedValue(new Error('timeout')),
      });
      const { service, prisma } = setup({ provider });

      const res = await service.book(CLINIC, INPUT);

      expect(prisma.appointment.create).toHaveBeenCalledTimes(1);
      expect(prisma.appointment.update).not.toHaveBeenCalled();
      expect(res).toMatchObject({
        appointmentId: 'apt-1',
        confirmed: false,
        externalId: null,
      });
    });

    it('a linha nasce como "bot" e só vira "integracao" quando confirma', async () => {
      const provider = providerMock({
        createAppointment: jest.fn().mockRejectedValue(new Error('timeout')),
      });
      const { service, prisma } = setup({ provider });
      await service.book(CLINIC, INPUT);
      expect(prisma.appointment.create.mock.calls[0][0].data.source).toBe(
        'bot',
      );
    });
  });

  describe('comportamento preservado', () => {
    // Regressão que o plano quase introduziu: `planReminders` busca por
    // `status in (agendado, confirmado)`. Nascer como `pedido` faria empresas
    // sem integração pararem de receber lembretes.
    it('sem integração, agendamento com horário nasce "agendado"', async () => {
      const { service, prisma } = setup();
      await service.book(CLINIC, INPUT);
      expect(prisma.appointment.create.mock.calls[0][0].data.status).toBe(
        'agendado',
      );
    });

    it('sem horário, nasce "pedido"', async () => {
      const { service, prisma } = setup();
      await service.book(CLINIC, {
        ...INPUT,
        startsAt: null,
        preferredTime: 'amanhã de manhã',
      });
      expect(prisma.appointment.create.mock.calls[0][0].data.status).toBe(
        'pedido',
      );
    });

    it('sem integração não confirma e não toca em provedor nenhum', async () => {
      const { service, integrations } = setup();
      const res = await service.book(CLINIC, INPUT);
      expect(res.confirmed).toBe(false);
      expect(integrations.getProvider).toHaveBeenCalledWith(CLINIC);
    });

    it('calcula endsAt a partir da duração do procedimento', async () => {
      const { service, prisma } = setup();
      await service.book(CLINIC, INPUT);
      expect(prisma.appointment.create.mock.calls[0][0].data.endsAt).toEqual(
        new Date('2026-10-01T14:00:00.000Z'),
      );
    });

    it('vincula o lead ao paciente externo quando a agenda confirma', async () => {
      const provider = providerMock();
      const { service, prisma } = setup({ provider });
      await service.book(CLINIC, INPUT);
      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { externalId: 'pac-1' },
      });
    });

    it('colisão de paciente em outro lead não derruba o agendamento', async () => {
      const provider = providerMock();
      const { service, prisma } = setup({ provider });
      prisma.lead.update.mockRejectedValueOnce(p2002());
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      await expect(service.book(CLINIC, INPUT)).resolves.toMatchObject({
        confirmed: true,
      });
    });
  });

  describe('re-checagem do horário antes da escrita (P0.5)', () => {
    const slot = (iso: string) => ({
      startsAt: iso,
      endsAt: null,
      professionalId: 'p1',
      professionalName: null,
      unitId: 'u1',
    });

    it('horário sumiu da lista → conflito: nada é gravado na agenda e o pedido vira "pedido"', async () => {
      const provider = providerMock({
        listAvailableSlots: jest
          .fn()
          .mockResolvedValue([slot('2026-10-01T14:00:00.000Z')]),
      });
      const { service, prisma } = setup({ provider });
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      const res = await service.book(CLINIC, INPUT);

      expect(provider.createAppointment).not.toHaveBeenCalled();
      expect(res).toMatchObject({
        confirmed: false,
        failureKind: 'conflito',
      });
      expect(prisma.appointment.update).toHaveBeenCalledWith({
        where: { id: 'apt-1' },
        data: { status: 'pedido' },
      });
    });

    it('horário está na lista → segue e grava', async () => {
      const provider = providerMock({
        listAvailableSlots: jest
          .fn()
          .mockResolvedValue([slot('2026-10-01T13:00:00.000Z')]),
      });
      const { service } = setup({ provider });

      const res = await service.book(CLINIC, INPUT);

      expect(provider.createAppointment).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject({ confirmed: true, failureKind: null });
    });

    // Fail-open deliberado: nenhum provedor oferece reserva atômica, e uma
    // consulta que falhou não é evidência de conflito — a agenda decide.
    it('lista vazia → fail-open, segue e grava', async () => {
      const provider = providerMock();
      const { service } = setup({ provider });
      await service.book(CLINIC, INPUT);
      expect(provider.createAppointment).toHaveBeenCalledTimes(1);
    });

    it('consulta falhou → fail-open, segue e grava', async () => {
      const provider = providerMock({
        listAvailableSlots: jest.fn().mockRejectedValue(new Error('timeout')),
      });
      const { service } = setup({ provider });
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
      const res = await service.book(CLINIC, INPUT);
      expect(provider.createAppointment).toHaveBeenCalledTimes(1);
      expect(res.confirmed).toBe(true);
    });
  });

  /**
   * O motivo da falha chega ao chamador (P0.1). É o que permite ao agente
   * mandar o cliente escolher outro horário quando faz sentido, e prometer o
   * retorno da equipe quando o problema é nosso.
   */
  describe('motivo da falha (P0.1)', () => {
    it.each([
      ['auth' as const, 'Credencial recusada'],
      ['indisponivel' as const, 'Google fora do ar'],
      ['timeout' as const, 'não respondeu'],
    ])('falha %s chega em failureKind', async (kind, message) => {
      const provider = providerMock({
        createAppointment: jest
          .fn()
          .mockRejectedValue(new AgendaProviderError(message, { kind })),
      });
      const { service } = setup({ provider });

      const res = await service.book(CLINIC, INPUT);

      expect(res).toMatchObject({ confirmed: false, failureKind: kind });
    });

    it('erro que não é da agenda vira desconhecido, não indisponível', async () => {
      const provider = providerMock({
        createAppointment: jest
          .fn()
          .mockRejectedValue(new TypeError('undefined is not a function')),
      });
      const { service } = setup({ provider });

      const res = await service.book(CLINIC, INPUT);

      expect(res.failureKind).toBe('desconhecido');
    });
  });
});

describe('AgendaService.cancel (P0.5)', () => {
  it('cancela na agenda real primeiro e depois aqui, com a data', async () => {
    const provider = providerMock();
    const { service, prisma } = setup({ provider });
    const ordem: string[] = [];
    prisma.appointment.findFirst
      .mockResolvedValueOnce(appointmentRow())
      .mockResolvedValueOnce(
        summaryRow({ status: 'cancelado', canceledAt: new Date() }),
      );
    provider.cancelAppointment.mockImplementation(() => {
      ordem.push('externo');
      return Promise.resolve();
    });
    prisma.appointment.update.mockImplementation(() => {
      ordem.push('local');
      return Promise.resolve({});
    });

    const res = await service.cancel(CLINIC, 'apt-1');

    expect(ordem).toEqual(['externo', 'local']);
    expect(provider.cancelAppointment).toHaveBeenCalledWith({
      externalId: 'ext-9',
      unitId: 'u1',
    });
    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'apt-1' },
      data: { status: 'cancelado', canceledAt: expect.any(Date) },
    });
    expect(res.status).toBe('cancelado');
  });

  it('cancelar duas vezes: a segunda é no-op de sucesso, sem chamada externa', async () => {
    const provider = providerMock();
    const { service, prisma } = setup({ provider });
    prisma.appointment.findFirst
      .mockResolvedValueOnce(appointmentRow({ status: 'cancelado' }))
      .mockResolvedValueOnce(summaryRow({ status: 'cancelado' }));

    const res = await service.cancel(CLINIC, 'apt-1');

    expect(res.status).toBe('cancelado');
    expect(provider.cancelAppointment).not.toHaveBeenCalled();
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('agenda recusou → 503 e nada muda aqui', async () => {
    const provider = providerMock({
      cancelAppointment: jest
        .fn()
        .mockRejectedValue(new Error('Clinicorp 500')),
    });
    const { service, prisma } = setup({ provider });
    prisma.appointment.findFirst.mockResolvedValueOnce(appointmentRow());

    await expect(service.cancel(CLINIC, 'apt-1')).rejects.toMatchObject({
      status: 503,
    });
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('sem id externo (ou integração desligada) cancela só aqui', async () => {
    const { service, prisma, integrations } = setup();
    prisma.appointment.findFirst
      .mockResolvedValueOnce(appointmentRow({ externalId: null }))
      .mockResolvedValueOnce(summaryRow({ status: 'cancelado' }));

    await service.cancel(CLINIC, 'apt-1');

    expect(integrations.getProvider).not.toHaveBeenCalled();
    expect(prisma.appointment.update).toHaveBeenCalledTimes(1);
  });

  it('agendamento de outra empresa → 404', async () => {
    const { service, prisma } = setup();
    prisma.appointment.findFirst.mockResolvedValueOnce(null);
    await expect(service.cancel(CLINIC, 'apt-1')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('AgendaService.reschedule (P0.5)', () => {
  const NEW = new Date('2026-10-02T13:00:00.000Z');

  it('move na agenda real e depois aqui; status volta a "agendado"', async () => {
    const provider = providerMock();
    const { service, prisma } = setup({ provider });
    prisma.appointment.findFirst
      .mockResolvedValueOnce(appointmentRow({ status: 'confirmado' }))
      .mockResolvedValueOnce(summaryRow({ startsAt: NEW }));

    const res = await service.reschedule(CLINIC, 'apt-1', NEW);

    expect(provider.rescheduleAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'ext-9',
        startsAt: NEW,
        endsAt: new Date('2026-10-02T14:00:00.000Z'), // mantém a duração
        patientId: 'pac-1',
        patientName: 'Ana Silva',
        unitId: 'u1',
        professionalId: 'p1',
      }),
    );
    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'apt-1' },
      data: expect.objectContaining({
        startsAt: NEW,
        status: 'agendado',
        canceledAt: null,
        externalId: 'ext-9',
      }),
    });
    expect(res.startsAt).toBe(NEW.toISOString());
  });

  it('o id externo pode mudar (Clinicorp cancela e recria) — a linha local acompanha', async () => {
    const provider = providerMock({
      rescheduleAppointment: jest
        .fn()
        .mockResolvedValue({ externalId: 'ext-novo', professionalName: null }),
    });
    const { service, prisma } = setup({ provider });
    prisma.appointment.findFirst
      .mockResolvedValueOnce(appointmentRow())
      .mockResolvedValueOnce(summaryRow({ externalId: 'ext-novo' }));

    await service.reschedule(CLINIC, 'apt-1', NEW);

    expect(prisma.appointment.update.mock.calls[0][0].data.externalId).toBe(
      'ext-novo',
    );
  });

  it('remarcar para o mesmo horário é no-op', async () => {
    const provider = providerMock();
    const { service, prisma } = setup({ provider });
    prisma.appointment.findFirst
      .mockResolvedValueOnce(appointmentRow())
      .mockResolvedValueOnce(summaryRow());

    await service.reschedule(
      CLINIC,
      'apt-1',
      new Date('2026-10-01T13:00:00.000Z'),
    );

    expect(provider.rescheduleAppointment).not.toHaveBeenCalled();
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('agenda recusou → 503 e o horário antigo continua valendo', async () => {
    const provider = providerMock({
      rescheduleAppointment: jest
        .fn()
        .mockRejectedValue(new Error('Google 503')),
    });
    const { service, prisma } = setup({ provider });
    prisma.appointment.findFirst.mockResolvedValueOnce(appointmentRow());

    await expect(
      service.reschedule(CLINIC, 'apt-1', NEW),
    ).rejects.toMatchObject({ status: 503 });
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  /**
   * O caso feio do Clinicorp (P0.1): ele não expõe reagendamento, então o
   * adapter cancela e recria. Falhar no meio libera o horário antigo sem criar
   * o novo — e a linha local, se ficasse como estava, mandaria um lembrete
   * para uma consulta que não existe mais em lugar nenhum.
   */
  it('horário liberado e novo não criado → vira "pedido" sem id externo, e ainda assim 503', async () => {
    const provider = providerMock({
      rescheduleAppointment: jest
        .fn()
        .mockRejectedValue(
          new AgendaSlotReleasedError('cancelou mas não recriou'),
        ),
    });
    const { service, prisma } = setup({ provider });
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    prisma.appointment.findFirst.mockResolvedValueOnce(appointmentRow());

    await expect(
      service.reschedule(CLINIC, 'apt-1', NEW),
    ).rejects.toMatchObject({ status: 503 });

    // A operação falhou para quem pediu — mas o banco conta a verdade.
    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'apt-1' },
      data: {
        status: 'pedido',
        startsAt: NEW,
        endsAt: new Date('2026-10-02T14:00:00.000Z'),
        externalId: null,
      },
    });
  });

  it('falha comum não rebaixa a linha — o horário antigo continua reservado lá', async () => {
    const provider = providerMock({
      rescheduleAppointment: jest
        .fn()
        .mockRejectedValue(
          new AgendaProviderError('Google 500', { kind: 'indisponivel' }),
        ),
    });
    const { service, prisma } = setup({ provider });
    prisma.appointment.findFirst.mockResolvedValueOnce(appointmentRow());

    await expect(service.reschedule(CLINIC, 'apt-1', NEW)).rejects.toThrow();
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('cancelado ou já atendido não se remarca (400); horário passado idem', async () => {
    const { service, prisma } = setup();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointmentRow({ status: 'cancelado' }),
    );
    await expect(
      service.reschedule(CLINIC, 'apt-1', NEW),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      service.reschedule(CLINIC, 'apt-1', new Date('2020-01-01T00:00:00Z')),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('agendamento de outra empresa → 404', async () => {
    const { service, prisma } = setup();
    prisma.appointment.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.reschedule(CLINIC, 'apt-1', NEW),
    ).rejects.toMatchObject({ status: 404 });
  });
});
