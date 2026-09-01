import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IntegrationService } from '../clinicorp/integration.service';
import type { ExternalAppointment } from '../clinicorp/agenda-provider';
import { PrismaService } from '../prisma/prisma.service';
import { AgendaSyncService } from './agenda-sync.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const NOW = new Date('2026-09-09T13:00:00.000Z');

function external(
  overrides: Partial<ExternalAppointment> = {},
): ExternalAppointment {
  return {
    externalId: 'ext-1',
    patientExternalId: '501',
    patientName: 'Marina Alves',
    patientPhone: '11999998888',
    startsAt: new Date('2026-09-12T13:00:00.000Z'),
    endsAt: new Date('2026-09-12T13:30:00.000Z'),
    professionalExternalId: '10',
    professionalName: 'Dra. Ana',
    unitExternalId: '1',
    statusExternalId: '6',
    statusName: 'Faltou',
    procedureName: 'Manutenção',
    ...overrides,
  };
}

describe('AgendaSyncService (sincronização por varredura · F9)', () => {
  let sync: AgendaSyncService;

  const providerMock = { listAppointments: jest.fn() };
  const prismaMock = {
    appointment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    lead: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    conversation: { findFirst: jest.fn() },
    clinicIntegration: { findMany: jest.fn() },
  };
  const integrationsMock = {
    getProvider: jest.fn(),
    statusMappingsOf: jest.fn(),
    translateStatus: jest.fn(),
    recordSync: jest.fn(),
    activeProviderName: jest.fn(),
  };
  const configMock = { get: jest.fn(() => undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    integrationsMock.getProvider.mockResolvedValue(providerMock);
    integrationsMock.statusMappingsOf.mockResolvedValue([]);
    integrationsMock.activeProviderName.mockResolvedValue('clinicorp');
    integrationsMock.translateStatus.mockReturnValue(null);
    prismaMock.appointment.findUnique.mockResolvedValue(null);
    prismaMock.appointment.create.mockResolvedValue({ id: 'a1' });
    prismaMock.lead.findUnique.mockResolvedValue(null);
    prismaMock.lead.findFirst.mockResolvedValue(null);
    prismaMock.lead.create.mockResolvedValue({ id: 'lead-novo' });
    prismaMock.lead.update.mockResolvedValue({ id: 'lead-whats' });
    prismaMock.conversation.findFirst.mockResolvedValue(null);
    providerMock.listAppointments.mockResolvedValue([external()]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgendaSyncService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: IntegrationService, useValue: integrationsMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();
    sync = moduleRef.get(AgendaSyncService);
  });

  const createdData = () => prismaMock.appointment.create.mock.calls[0][0].data;

  it('integração desligada: não faz nada', async () => {
    integrationsMock.getProvider.mockResolvedValueOnce(null);

    const summary = await sync.syncClinic(CLINIC, NOW);

    expect(summary).toEqual({ criados: 0, atualizados: 0, ignorados: 0 });
    expect(providerMock.listAppointments).not.toHaveBeenCalled();
  });

  it('cria o agendamento importado marcando a origem', async () => {
    const summary = await sync.syncClinic(CLINIC, NOW);

    expect(summary.criados).toBe(1);
    expect(createdData()).toMatchObject({
      clinicId: CLINIC,
      externalId: 'ext-1',
      source: 'integracao',
      professionalName: 'Dra. Ana',
    });
  });

  it('agendamento já conhecido é atualizado, não duplicado', async () => {
    prismaMock.appointment.findUnique.mockResolvedValueOnce({
      id: 'a1',
      status: 'agendado',
      leadId: 'lead-1',
      conversationId: 'conv-1',
    });

    const summary = await sync.syncClinic(CLINIC, NOW);

    expect(summary.atualizados).toBe(1);
    expect(prismaMock.appointment.create).not.toHaveBeenCalled();
  });

  describe('status: ordem de autoridade', () => {
    it('1º — o mapeamento que o operador confirmou', async () => {
      integrationsMock.translateStatus.mockReturnValueOnce('cancelado');

      await sync.syncClinic(CLINIC, NOW);

      expect(createdData().status).toBe('cancelado');
    });

    it('2º — a sugestão por nome, quando ninguém mapeou ainda', async () => {
      await sync.syncClinic(CLINIC, NOW);
      expect(createdData().status).toBe('faltou');
    });

    it('3º — status irreconhecível não reclassifica o que já existe', async () => {
      // O princípio: um status que ninguém reconheceu não pode mexer sozinho
      // num agendamento.
      prismaMock.appointment.findUnique.mockResolvedValueOnce({
        id: 'a1',
        status: 'compareceu',
        leadId: 'lead-1',
        conversationId: null,
      });
      providerMock.listAppointments.mockResolvedValueOnce([
        external({ statusName: 'Orçamento enviado', statusExternalId: '8' }),
      ]);

      await sync.syncClinic(CLINIC, NOW);

      expect(prismaMock.appointment.update.mock.calls[0][0].data.status).toBe(
        'compareceu',
      );
    });

    it('4º — registro novo sem pista nenhuma nasce agendado', async () => {
      providerMock.listAppointments.mockResolvedValueOnce([
        external({ statusName: null, statusExternalId: null }),
      ]);

      await sync.syncClinic(CLINIC, NOW);

      expect(createdData().status).toBe('agendado');
    });
  });

  describe('identificação do paciente', () => {
    it('reusa o contato pelo id externo', async () => {
      prismaMock.lead.findUnique.mockResolvedValueOnce({ id: 'lead-ext' });

      await sync.syncClinic(CLINIC, NOW);

      expect(createdData().leadId).toBe('lead-ext');
      expect(prismaMock.lead.create).not.toHaveBeenCalled();
    });

    it('reusa pelo telefone quem já falou com o bot, e grava o id externo', async () => {
      // O duplicado clássico: o mesmo paciente que conversou no WhatsApp e
      // agora aparece na agenda importada.
      prismaMock.lead.findFirst.mockResolvedValueOnce({
        id: 'lead-whats',
        externalId: null,
      });

      await sync.syncClinic(CLINIC, NOW);

      expect(createdData().leadId).toBe('lead-whats');
      expect(prismaMock.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-whats' },
          data: { externalId: '501' },
        }),
      );
    });

    it('busca o telefone já normalizado com DDI', async () => {
      await sync.syncClinic(CLINIC, NOW);

      expect(prismaMock.lead.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clinicId: CLINIC, phone: '5511999998888' },
        }),
      );
    });

    it('cria o contato quando não existe', async () => {
      await sync.syncClinic(CLINIC, NOW);

      expect(prismaMock.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clinicId: CLINIC,
            name: 'Marina Alves',
            phone: '5511999998888',
            externalId: '501',
            source: 'clinicorp',
          }),
        }),
      );
    });

    it('sem telefone e sem id, não inventa um contato', async () => {
      // Criar uma "Maria" solta geraria duplicata a cada varredura.
      providerMock.listAppointments.mockResolvedValueOnce([
        external({ patientExternalId: null, patientPhone: null }),
      ]);

      await sync.syncClinic(CLINIC, NOW);

      expect(prismaMock.lead.create).not.toHaveBeenCalled();
      expect(createdData().leadId).toBeNull();
    });

    it('vincula a conversa mais recente do contato (detecção de resposta)', async () => {
      prismaMock.lead.findUnique.mockResolvedValueOnce({ id: 'lead-ext' });
      prismaMock.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-9' });

      await sync.syncClinic(CLINIC, NOW);

      expect(createdData().conversationId).toBe('conv-9');
    });
  });

  it('um agendamento problemático não derruba a rodada', async () => {
    providerMock.listAppointments.mockResolvedValueOnce([
      external({ externalId: 'ruim' }),
      external({ externalId: 'bom' }),
    ]);
    prismaMock.appointment.create
      .mockRejectedValueOnce(new Error('violação de unicidade'))
      .mockResolvedValueOnce({ id: 'a2' });

    const summary = await sync.syncClinic(CLINIC, NOW);

    expect(summary.ignorados).toBe(1);
    expect(summary.criados).toBe(1);
  });

  it('registra a sincronização bem-sucedida', async () => {
    await sync.syncClinic(CLINIC, NOW);
    expect(integrationsMock.recordSync).toHaveBeenCalledWith(CLINIC, null);
  });

  it('syncAll registra o erro da empresa que falhou e segue', async () => {
    prismaMock.clinicIntegration.findMany.mockResolvedValueOnce([
      { clinicId: 'a' },
      { clinicId: CLINIC },
    ]);
    integrationsMock.getProvider
      .mockRejectedValueOnce(new Error('credencial inválida'))
      .mockResolvedValue(providerMock);

    const summary = await sync.syncAll();

    expect(integrationsMock.recordSync).toHaveBeenCalledWith(
      'a',
      expect.stringContaining('credencial inválida'),
    );
    expect(summary.criados).toBe(1);
  });
});
