import { AgendaService, type BookInput } from './agenda.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';

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
});
