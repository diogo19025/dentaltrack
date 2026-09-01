import { Test } from '@nestjs/testing';
import { DEFAULT_AUTOMATION_SETTINGS } from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  AutomationSettingsService,
  toRow,
  toSettings,
} from './automation-settings.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';

describe('AutomationSettingsService (configuração das automações · F9)', () => {
  let service: AutomationSettingsService;

  const prismaMock = {
    automationSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AutomationSettingsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(AutomationSettingsService);
  });

  it('linha ↔ contrato é uma ida e volta sem perda', () => {
    // Se este teste quebrar, alguma configuração está sendo salva num campo e
    // lida de outro — falha silenciosa que só apareceria como "liguei e não
    // funcionou".
    expect(toSettings(toRow(DEFAULT_AUTOMATION_SETTINGS))).toEqual(
      DEFAULT_AUTOMATION_SETTINGS,
    );
  });

  it('o aviso de atraso nasce desligado', () => {
    // Padrão seguro: ele só é correto se a recepção marcar a chegada em tempo
    // real, então o dono liga quando a operação dele aguentar.
    expect(DEFAULT_AUTOMATION_SETTINGS.atraso.enabled).toBe(false);
    expect(DEFAULT_AUTOMATION_SETTINGS.atraso.toleranceMinutes).toBe(15);
  });

  it('os lembretes nascem ligados, com teto diário e janela de horário', () => {
    expect(DEFAULT_AUTOMATION_SETTINGS.lembrete3d.enabled).toBe(true);
    expect(DEFAULT_AUTOMATION_SETTINGS.sendWindowStart).toBe('08:00');
    expect(DEFAULT_AUTOMATION_SETTINGS.sendWindowEnd).toBe('20:00');
    expect(DEFAULT_AUTOMATION_SETTINGS.dailyCap).toBeGreaterThan(0);
  });

  it('a cadência de falta tem teto rígido no contrato', () => {
    expect(DEFAULT_AUTOMATION_SETTINGS.falta.attempts).toBeLessThanOrEqual(3);
  });

  it('primeiro acesso cria a linha com os padrões de fábrica', async () => {
    prismaMock.automationSettings.findUnique.mockResolvedValueOnce(null);
    prismaMock.automationSettings.upsert.mockResolvedValueOnce(
      toRow(DEFAULT_AUTOMATION_SETTINGS),
    );

    const settings = await service.get(CLINIC);

    expect(settings).toEqual(DEFAULT_AUTOMATION_SETTINGS);
    expect(prismaMock.automationSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clinicId: CLINIC },
        create: expect.objectContaining({ clinicId: CLINIC }),
        update: {},
      }),
    );
  });

  it('update parcial preserva o que não veio no corpo', async () => {
    prismaMock.automationSettings.findUnique.mockResolvedValue(
      toRow(DEFAULT_AUTOMATION_SETTINGS),
    );
    prismaMock.automationSettings.update.mockImplementation(
      ({ data }: { data: unknown }) => Promise.resolve(data),
    );

    const updated = await service.update(CLINIC, {
      atraso: { enabled: true, toleranceMinutes: 20, template: 'Oi!' },
    });

    expect(updated.atraso).toEqual({
      enabled: true,
      toleranceMinutes: 20,
      template: 'Oi!',
    });
    // Os demais textos continuam intactos.
    expect(updated.lembrete1d.template).toBe(
      DEFAULT_AUTOMATION_SETTINGS.lembrete1d.template,
    );
    expect(updated.dailyCap).toBe(DEFAULT_AUTOMATION_SETTINGS.dailyCap);
  });

  it('update de uma regra aceita campos soltos sem apagar os irmãos', async () => {
    prismaMock.automationSettings.findUnique.mockResolvedValue(
      toRow(DEFAULT_AUTOMATION_SETTINGS),
    );
    prismaMock.automationSettings.update.mockImplementation(
      ({ data }: { data: unknown }) => Promise.resolve(data),
    );

    const updated = await service.update(CLINIC, {
      falta: { enabled: false } as never,
    });

    expect(updated.falta.enabled).toBe(false);
    expect(updated.falta.attempts).toBe(
      DEFAULT_AUTOMATION_SETTINGS.falta.attempts,
    );
    expect(updated.falta.template).toBe(
      DEFAULT_AUTOMATION_SETTINGS.falta.template,
    );
  });
});
