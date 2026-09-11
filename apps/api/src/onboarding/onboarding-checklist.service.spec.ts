import { Test } from '@nestjs/testing';
import { IntegrationService } from '../clinicorp/integration.service';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingChecklistService } from './onboarding-checklist.service';

const CLINIC = '00000000-0000-0000-0000-0000000f1101';

describe('OnboardingChecklistService (checklist derivado · P1.1)', () => {
  let service: OnboardingChecklistService;

  const prismaMock = {
    clinicSettings: { findUnique: jest.fn() },
    procedure: { count: jest.fn() },
    tag: { count: jest.fn() },
    automationSettings: { findUnique: jest.fn() },
  };
  const integrationsMock = { hasUsableProvider: jest.fn() };

  /** Empresa recém-criada: nada feito. */
  function blankClinic() {
    prismaMock.clinicSettings.findUnique.mockResolvedValue(null);
    prismaMock.procedure.count.mockResolvedValue(0);
    prismaMock.tag.count.mockResolvedValue(0);
    integrationsMock.hasUsableProvider.mockResolvedValue(false);
    prismaMock.automationSettings.findUnique.mockResolvedValue(null);
  }

  const item = (
    dto: { items: { key: string; done: boolean }[] },
    key: string,
  ) => dto.items.find((i) => i.key === key)?.done;

  beforeEach(async () => {
    jest.clearAllMocks();
    blankClinic();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OnboardingChecklistService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: IntegrationService, useValue: integrationsMock },
      ],
    }).compile();
    service = moduleRef.get(OnboardingChecklistService);
  });

  it('empresa nova: seis itens, nenhum feito, cada um apontando para a sua aba', async () => {
    const dto = await service.getChecklist(CLINIC);

    expect(dto.total).toBe(6);
    expect(dto.done).toBe(0);
    expect(dto.complete).toBe(false);
    expect(dto.items.map((i) => i.key)).toEqual([
      'identidade',
      'procedimentos',
      'tags',
      'whatsapp',
      'agenda',
      'automacoes',
    ]);
    expect(dto.items.every((i) => !i.done)).toBe(true);
    expect(dto.items.map((i) => i.href)).toEqual([
      '/settings?tab=identidade',
      '/settings?tab=procedimentos',
      '/settings?tab=tags',
      '/settings?tab=whatsapp',
      '/settings?tab=integracao',
      '/settings?tab=automacoes',
    ]);
  });

  it('identidade só conta com especialidade, nome do assistente e saudação preenchidos', async () => {
    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      specialty: 'barbearia',
      assistantName: 'Léo',
      greeting: '   ',
      whatsappState: null,
    });
    expect(item(await service.getChecklist(CLINIC), 'identidade')).toBe(false);

    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      specialty: 'barbearia',
      assistantName: 'Léo',
      greeting: 'Fala! Sou o Léo.',
      whatsappState: null,
    });
    expect(item(await service.getChecklist(CLINIC), 'identidade')).toBe(true);
  });

  it('WhatsApp só conta quando o estado persistido é "conectado"', async () => {
    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      specialty: null,
      assistantName: null,
      greeting: null,
      whatsappState: 'aguardando_leitura',
    });
    expect(item(await service.getChecklist(CLINIC), 'whatsapp')).toBe(false);

    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      specialty: null,
      assistantName: null,
      greeting: null,
      whatsappState: 'conectado',
    });
    expect(item(await service.getChecklist(CLINIC), 'whatsapp')).toBe(true);
  });

  it('a linha de automações criada sozinha não conta como revisada; salvar conta', async () => {
    prismaMock.automationSettings.findUnique.mockResolvedValue({
      reviewedAt: null,
    });
    expect(item(await service.getChecklist(CLINIC), 'automacoes')).toBe(false);

    prismaMock.automationSettings.findUnique.mockResolvedValue({
      reviewedAt: new Date('2026-09-10T12:00:00.000Z'),
    });
    expect(item(await service.getChecklist(CLINIC), 'automacoes')).toBe(true);
  });

  it('só procedimentos ativos contam; a agenda exige um provedor utilizável', async () => {
    prismaMock.procedure.count.mockResolvedValue(3);
    prismaMock.tag.count.mockResolvedValue(1);
    integrationsMock.hasUsableProvider.mockResolvedValue(true);

    const dto = await service.getChecklist(CLINIC);

    expect(prismaMock.procedure.count).toHaveBeenCalledWith({
      where: { clinicId: CLINIC, active: true },
    });
    expect(integrationsMock.hasUsableProvider).toHaveBeenCalledWith(CLINIC);
    expect(item(dto, 'procedimentos')).toBe(true);
    expect(item(dto, 'tags')).toBe(true);
    expect(item(dto, 'agenda')).toBe(true);
    expect(dto.done).toBe(3);
  });

  it('tudo feito → complete, e o card pode sumir', async () => {
    prismaMock.clinicSettings.findUnique.mockResolvedValue({
      specialty: 'estética',
      assistantName: 'Bia',
      greeting: 'Oi!',
      whatsappState: 'conectado',
    });
    prismaMock.procedure.count.mockResolvedValue(1);
    prismaMock.tag.count.mockResolvedValue(1);
    integrationsMock.hasUsableProvider.mockResolvedValue(true);
    prismaMock.automationSettings.findUnique.mockResolvedValue({
      reviewedAt: new Date('2026-09-10T13:00:00.000Z'),
    });

    const dto = await service.getChecklist(CLINIC);
    expect(dto.done).toBe(6);
    expect(dto.complete).toBe(true);
  });
});
