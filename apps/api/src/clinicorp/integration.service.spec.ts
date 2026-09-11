import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GoogleAgendaProvider } from '../google-agenda/google-agenda.provider';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicorpAgendaProvider } from './clinicorp.provider';
import { encryptSecret } from './credentials-crypto';
import { IntegrationService } from './integration.service';
import { MockAgendaProvider } from './mock.provider';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const KEY = randomBytes(32);

describe('IntegrationService (configuração da integração · F9/F12)', () => {
  let integrations: IntegrationService;

  const prismaMock = {
    clinicIntegration: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    automationSettings: { findUnique: jest.fn() },
  };
  /** Env simulada — os testes ligam/desligam a service account do Google aqui. */
  const env: Record<string, string | undefined> = {};
  const configMock = { get: jest.fn((key: string) => env[key]) };

  const credentials = {
    username: 'api-clinicorp',
    token: 's3cr3t-token',
    subscriberId: 'sub-1',
    baseUrl: null,
  };

  const googleConfig = {
    calendarId: 'clinica@group.calendar.google.com',
    workStart: '08:00',
    workEnd: '18:00',
    workDays: [1, 2, 3, 4, 5],
    slotMinutes: 30,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    for (const key of Object.keys(env)) delete env[key];
    env.INTEGRATION_ENCRYPTION_KEY = KEY.toString('hex');
    prismaMock.automationSettings.findUnique.mockResolvedValue(null);
    prismaMock.clinicIntegration.findFirst.mockResolvedValue(null);
    prismaMock.clinicIntegration.findUnique.mockResolvedValue(null);

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
    it('nenhuma integração ligada: nenhum provedor (o produto segue funcionando)', async () => {
      prismaMock.clinicIntegration.findFirst.mockResolvedValueOnce(null);
      expect(await integrations.getProvider(CLINIC)).toBeNull();
    });

    it('modo simulado: provedor determinístico, sem chamada externa', async () => {
      prismaMock.clinicIntegration.findFirst.mockResolvedValueOnce({
        provider: 'clinicorp',
        mode: 'mock',
        credentials: null,
      });

      const provider = await integrations.getProvider(CLINIC);

      expect(provider).toBeInstanceOf(MockAgendaProvider);
      expect(provider?.live).toBe(false);
    });

    it('modo simulado: a mesma agenda entre chamadas — o que o agente marca, a tela vê', async () => {
      const row = { provider: 'clinicorp', mode: 'mock', credentials: null };
      prismaMock.clinicIntegration.findFirst.mockResolvedValue(row);

      const first = await integrations.getProvider(CLINIC);
      const second = await integrations.getProvider(CLINIC);
      expect(second).toBe(first);

      const startsAt = new Date(Date.now() + 400 * 24 * 3_600_000);
      await first!.createAppointment({
        patientId: '501',
        patientName: 'Marina Alves',
        patientPhone: null,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        professionalId: '10',
        unitId: '1',
        procedureName: 'Avaliação',
      });
      const seen = await second!.listAppointments({
        from: new Date(startsAt.getTime() - 3_600_000),
        to: new Date(startsAt.getTime() + 3_600_000),
      });
      expect(seen.map((a) => a.patientName)).toContain('Marina Alves');
    });

    it('modo simulado: empresas diferentes não compartilham a agenda', async () => {
      prismaMock.clinicIntegration.findFirst.mockResolvedValue({
        provider: 'clinicorp',
        mode: 'mock',
        credentials: null,
      });
      const a = await integrations.getProvider(CLINIC);
      const b = await integrations.getProvider(
        '00000000-0000-0000-0000-00000000c1b2',
      );
      expect(b).not.toBe(a);
    });

    it('Clinicorp real com credenciais: adapter do fornecedor', async () => {
      prismaMock.clinicIntegration.findFirst.mockResolvedValueOnce({
        provider: 'clinicorp',
        mode: 'live',
        credentials: encryptSecret(JSON.stringify(credentials), KEY),
        unitId: '1',
        professionalId: '10',
      });

      const provider = await integrations.getProvider(CLINIC);

      expect(provider).toBeInstanceOf(ClinicorpAgendaProvider);
      expect(provider?.live).toBe(true);
    });

    it('Clinicorp real SEM credenciais: nenhum provedor, em vez de chamada anônima', async () => {
      prismaMock.clinicIntegration.findFirst.mockResolvedValueOnce({
        provider: 'clinicorp',
        mode: 'live',
        credentials: null,
      });
      expect(await integrations.getProvider(CLINIC)).toBeNull();
    });

    it('credencial ilegível não derruba: cai para nenhum provedor', async () => {
      prismaMock.clinicIntegration.findFirst.mockResolvedValueOnce({
        provider: 'clinicorp',
        mode: 'live',
        credentials: 'v1.lixo.lixo.lixo',
      });
      expect(await integrations.getProvider(CLINIC)).toBeNull();
    });

    it('Google real com agenda e service account: adapter do Google', async () => {
      env.GOOGLE_CALENDAR_SA_EMAIL = 'agenda@projeto.iam.gserviceaccount.com';
      env.GOOGLE_CALENDAR_SA_KEY = 'chave-pem';
      prismaMock.clinicIntegration.findFirst.mockResolvedValueOnce({
        provider: 'google',
        mode: 'live',
        credentials: encryptSecret(JSON.stringify(googleConfig), KEY),
      });

      const provider = await integrations.getProvider(CLINIC);

      expect(provider).toBeInstanceOf(GoogleAgendaProvider);
      expect(provider?.live).toBe(true);
    });

    it('Google real sem a service account no servidor: nenhum provedor', async () => {
      prismaMock.clinicIntegration.findFirst.mockResolvedValueOnce({
        provider: 'google',
        mode: 'live',
        credentials: encryptSecret(JSON.stringify(googleConfig), KEY),
      });
      expect(await integrations.getProvider(CLINIC)).toBeNull();
    });

    it('Google real sem agenda configurada: nenhum provedor', async () => {
      env.GOOGLE_CALENDAR_SA_EMAIL = 'agenda@projeto.iam.gserviceaccount.com';
      env.GOOGLE_CALENDAR_SA_KEY = 'chave-pem';
      prismaMock.clinicIntegration.findFirst.mockResolvedValueOnce({
        provider: 'google',
        mode: 'live',
        credentials: null,
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
        provider: 'clinicorp',
        mode: 'live',
        credentials: encryptSecret(JSON.stringify(credentials), KEY),
        unitId: '1',
        professionalId: null,
        statusMappings: [],
        lastCheckedAt: null,
        lastSyncedAt: null,
        lastError: null,
      });

      const status = await integrations.getStatus(CLINIC, 'clinicorp');

      expect(status.hasCredentials).toBe(true);
      expect(status.usernameHint).toBe('ap******rp');
      expect(JSON.stringify(status)).not.toContain('s3cr3t-token');
      expect(JSON.stringify(status)).not.toContain('api-clinicorp');
    });

    it('provider google devolve a configuração (não é segredo) e o e-mail da service account', async () => {
      env.GOOGLE_CALENDAR_SA_EMAIL = 'agenda@projeto.iam.gserviceaccount.com';
      env.GOOGLE_CALENDAR_SA_KEY = 'chave-pem';
      prismaMock.clinicIntegration.findUnique.mockResolvedValueOnce({
        provider: 'google',
        mode: 'live',
        credentials: encryptSecret(JSON.stringify(googleConfig), KEY),
        statusMappings: [],
      });
      prismaMock.clinicIntegration.findFirst.mockResolvedValueOnce({
        provider: 'google',
        mode: 'live',
      });

      const status = await integrations.getStatus(CLINIC, 'google');

      expect(status.google?.calendarId).toBe(googleConfig.calendarId);
      expect(status.hasCredentials).toBe(true);
      expect(status.activeProvider).toBe('google');
      expect(status.serviceAccountEmail).toBe(
        'agenda@projeto.iam.gserviceaccount.com',
      );
    });

    it('sem a service account no servidor, serviceAccountEmail é null (a tela avisa)', async () => {
      const status = await integrations.getStatus(CLINIC, 'google');
      expect(status.serviceAccountEmail).toBeNull();
      expect(status.hasCredentials).toBe(false);
    });

    it('mapeamentos inválidos no banco são descartados em silêncio', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValueOnce({
        provider: 'clinicorp',
        mode: 'mock',
        credentials: null,
        statusMappings: [
          { externalId: '1', externalName: 'Agendado', status: 'agendado' },
          { externalId: '2' }, // incompleto
          'lixo',
        ],
      });

      const status = await integrations.getStatus(CLINIC, 'clinicorp');
      expect(status.statusMappings).toHaveLength(1);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prismaMock.clinicIntegration.upsert.mockResolvedValue({});
      prismaMock.clinicIntegration.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.clinicIntegration.findUnique.mockResolvedValue({
        provider: 'clinicorp',
        mode: 'mock',
        credentials: null,
        statusMappings: [],
      });
    });

    it('cifra a credencial antes de gravar', async () => {
      await integrations.update(CLINIC, 'clinicorp', {
        mode: 'live',
        credentials,
      });

      const data = prismaMock.clinicIntegration.upsert.mock.calls[0][0].update;
      expect(data.credentials).toMatch(/^v1\./);
      expect(data.credentials).not.toContain('s3cr3t-token');
    });

    it('credencial omitida mantém a que já está salva', async () => {
      // A tela nunca recebeu o token de volta; trocar de unidade não pode
      // exigir redigitá-lo.
      await integrations.update(CLINIC, 'clinicorp', { unitId: '2' });

      const data = prismaMock.clinicIntegration.upsert.mock.calls[0][0].update;
      expect(data).toEqual({ unitId: '2' });
      expect(data.credentials).toBeUndefined();
    });

    it('ligar um provedor desliga o outro — só uma fonte de verdade de agenda', async () => {
      await integrations.update(CLINIC, 'google', {
        mode: 'live',
        google: googleConfig,
      });

      expect(prismaMock.clinicIntegration.updateMany).toHaveBeenCalledWith({
        where: {
          clinicId: CLINIC,
          provider: { not: 'google' },
          mode: { not: 'desligado' },
        },
        data: { mode: 'desligado' },
      });
    });

    it('desligar não mexe nos outros provedores', async () => {
      await integrations.update(CLINIC, 'google', { mode: 'desligado' });
      expect(prismaMock.clinicIntegration.updateMany).not.toHaveBeenCalled();
    });

    it('a configuração do Google também é gravada cifrada', async () => {
      await integrations.update(CLINIC, 'google', {
        mode: 'live',
        google: googleConfig,
      });

      const data = prismaMock.clinicIntegration.upsert.mock.calls[0][0].update;
      expect(data.credentials).toMatch(/^v1\./);
      expect(data.credentials).not.toContain(googleConfig.calendarId);
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
        provider: 'clinicorp',
        mode: 'desligado',
        credentials: null,
        statusMappings: [],
      });

      const result = await integrations.check(CLINIC, 'clinicorp');

      expect(result.ok).toBe(false);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].detail).toContain('desligada');
    });

    it('Google real sem service account explica exatamente o que falta', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValue({
        provider: 'google',
        mode: 'live',
        credentials: encryptSecret(JSON.stringify(googleConfig), KEY),
        statusMappings: [],
      });
      prismaMock.clinicIntegration.findFirst.mockResolvedValue({
        provider: 'google',
        mode: 'live',
      });

      const result = await integrations.check(CLINIC, 'google');

      expect(result.ok).toBe(false);
      expect(result.steps[0].detail).toContain('GOOGLE_CALENDAR_SA_EMAIL');
    });

    it('modo simulado percorre a cadeia inteira e descobre unidades e status', async () => {
      prismaMock.clinicIntegration.findUnique.mockResolvedValue({
        provider: 'clinicorp',
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

      const result = await integrations.check(CLINIC, 'clinicorp');

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
