import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicorpAgendaProvider } from './clinicorp.provider';
import { encryptSecret } from './credentials-crypto';
import { IntegrationService } from './integration.service';
import { MockAgendaProvider } from './mock.provider';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const KEY = randomBytes(32);

describe('IntegrationService (configuração da integração · F9)', () => {
  let integrations: IntegrationService;

  const prismaMock = {
    clinicIntegration: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    automationSettings: { findUnique: jest.fn() },
  };
  const configMock = {
    get: jest.fn((key: string) =>
      key === 'INTEGRATION_ENCRYPTION_KEY' ? KEY.toString('hex') : undefined,
    ),
  };

  const credentials = {
    username: 'api-clinicorp',
    token: 's3cr3t-token',
    subscriberId: 'sub-1',
    baseUrl: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.automationSettings.findUnique.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        IntegrationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();
    integrations = moduleRef.get(IntegrationService);
  });

  describe('getProvider — qual agenda a empresa usa', () => {
    it('desligada: nenhum provedor (o produto segue funcionando sem integração)', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValueOnce({
        mode: 'desligado',
      });
      expect(await integrations.getProvider(CLINIC)).toBeNull();
    });

    it('sem configuração nenhuma: nenhum provedor', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValueOnce(null);
      expect(await integrations.getProvider(CLINIC)).toBeNull();
    });

    it('modo simulado: provedor determinístico, sem chamada externa', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValueOnce({
        mode: 'mock',
      });

      const provider = await integrations.getProvider(CLINIC);

      expect(provider).toBeInstanceOf(MockAgendaProvider);
      expect(provider?.live).toBe(false);
    });

    it('modo real com credenciais: adapter do fornecedor', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValueOnce({
        mode: 'live',
        credentials: encryptSecret(JSON.stringify(credentials), KEY),
        unitId: '1',
        professionalId: '10',
      });

      const provider = await integrations.getProvider(CLINIC);

      expect(provider).toBeInstanceOf(ClinicorpAgendaProvider);
      expect(provider?.live).toBe(true);
    });

    it('modo real SEM credenciais: nenhum provedor, em vez de chamada anônima', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValueOnce({
        mode: 'live',
        credentials: null,
      });
      expect(await integrations.getProvider(CLINIC)).toBeNull();
    });

    it('credencial ilegível não derruba: cai para nenhum provedor', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValueOnce({
        mode: 'live',
        credentials: 'v1.lixo.lixo.lixo',
      });
      expect(await integrations.getProvider(CLINIC)).toBeNull();
    });

    it('usa o fuso configurado nas automações da empresa', async () => {
      prismaMock.automationSettings.findUnique.mockResolvedValueOnce({
        timezone: 'America/Manaus',
      });
      expect(await integrations.timeZoneOf(CLINIC)).toBe('America/Manaus');
    });
  });

  describe('getStatus — o segredo nunca sai do servidor', () => {
    it('devolve só a dica do usuário, jamais o token', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValueOnce({
        mode: 'live',
        credentials: encryptSecret(JSON.stringify(credentials), KEY),
        unitId: '1',
        professionalId: null,
        statusMappings: [],
        lastCheckedAt: null,
        lastSyncedAt: null,
        lastError: null,
      });

      const status = await integrations.getStatus(CLINIC);

      expect(status.hasCredentials).toBe(true);
      expect(status.usernameHint).toBe('ap******rp');
      expect(JSON.stringify(status)).not.toContain('s3cr3t-token');
      expect(JSON.stringify(status)).not.toContain('api-clinicorp');
    });

    it('mapeamentos inválidos no banco são descartados em silêncio', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValueOnce({
        mode: 'mock',
        credentials: null,
        statusMappings: [
          { externalId: '1', externalName: 'Agendado', status: 'agendado' },
          { externalId: '2' }, // incompleto
          'lixo',
        ],
      });

      const status = await integrations.getStatus(CLINIC);
      expect(status.statusMappings).toHaveLength(1);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prismaMock.clinicIntegration.upsert.mockResolvedValue({});
      prismaMock.clinicIntegration.findUnique.mockResolvedValue({
        mode: 'mock',
        credentials: null,
        statusMappings: [],
      });
    });

    it('cifra a credencial antes de gravar', async () => {
      await integrations.update(CLINIC, { mode: 'live', credentials });

      const data = prismaMock.clinicIntegration.upsert.mock.calls[0][0].update;
      expect(data.credentials).toMatch(/^v1\./);
      expect(data.credentials).not.toContain('s3cr3t-token');
    });

    it('credencial omitida mantém a que já está salva', async () => {
      // A tela nunca recebeu o token de volta; trocar de unidade não pode
      // exigir redigitá-lo.
      await integrations.update(CLINIC, { unitId: '2' });

      const data = prismaMock.clinicIntegration.upsert.mock.calls[0][0].update;
      expect(data).toEqual({ unitId: '2' });
      expect(data.credentials).toBeUndefined();
    });
  });

  describe('translateStatus', () => {
    const mappings = [
      { externalId: '6', externalName: 'Faltou', status: 'faltou' as const },
      { externalId: '8', externalName: 'Orçamento', status: null },
    ];

    it('casa por id', () => {
      expect(integrations.translateStatus(mappings, '6', 'Qualquer')).toBe(
        'faltou',
      );
    });

    it('sem id, casa por nome (conta migrada troca ids, mantém nomes)', () => {
      expect(integrations.translateStatus(mappings, '99', 'faltou')).toBe(
        'faltou',
      );
    });

    it('mapeado para "ignorar" devolve null', () => {
      expect(
        integrations.translateStatus(mappings, '8', 'Orçamento'),
      ).toBeNull();
    });

    it('desconhecido devolve null — "não mexe"', () => {
      expect(integrations.translateStatus(mappings, '42', 'Outro')).toBeNull();
      expect(integrations.translateStatus([], null, null)).toBeNull();
    });
  });

  describe('check — a verificação só-leitura', () => {
    it('integração desligada explica o que fazer, sem chamar nada', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValue({
        mode: 'desligado',
        credentials: null,
        statusMappings: [],
      });

      const result = await integrations.check(CLINIC);

      expect(result.ok).toBe(false);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].detail).toContain('desligada');
    });

    it('modo simulado percorre a cadeia inteira e descobre unidades e status', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValue({
        mode: 'mock',
        credentials: null,
        unitId: null,
        professionalId: null,
        statusMappings: [],
        lastCheckedAt: null,
        lastSyncedAt: null,
        lastError: null,
      });
      prismaMock.clinicIntegration.updateMany.mockResolvedValue({ count: 1 });

      const result = await integrations.check(CLINIC);

      expect(result.ok).toBe(true);
      expect(result.steps.map((s) => s.key)).toEqual([
        'credenciais',
        'unidades',
        'profissionais',
        'status',
        'disponibilidade',
        'agenda',
      ]);
      expect(result.units.length).toBeGreaterThan(0);
      expect(result.statuses.length).toBeGreaterThan(0);
      // O resultado é gravado para a tela mostrar a última verificação.
      expect(prismaMock.clinicIntegration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastError: null }),
        }),
      );
    });
  });
});
