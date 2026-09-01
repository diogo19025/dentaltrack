import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  WhatsappConnectionService,
  readPhone,
  readQrCode,
  toConnectionState,
} from './connection.service';
import { EvolutionService } from './evolution.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const INSTANCE = 'empresa-sorriso-00000000';

describe('WhatsappConnectionService (pareamento por QR · F10)', () => {
  let connection: WhatsappConnectionService;

  const prismaMock = {
    clinic: { findUniqueOrThrow: jest.fn() },
    clinicSettings: { upsert: jest.fn(), updateMany: jest.fn() },
  };
  const evolutionMock = {
    isConfigured: jest.fn(),
    createInstance: jest.fn(),
    connectInstance: jest.fn(),
    connectionState: jest.fn(),
    fetchInstance: jest.fn(),
    logoutInstance: jest.fn(),
    deleteInstance: jest.fn(),
  };
  const env: Record<string, string | undefined> = {};
  const configMock = { get: jest.fn((key: string) => env[key]) };

  /** Empresa com (ou sem) instância já vinculada. */
  const withClinic = (
    settings: {
      whatsappInstance?: string | null;
      whatsappOnboardingAnsweredAt?: Date | null;
    } | null = null,
  ) => {
    prismaMock.clinic.findUniqueOrThrow.mockResolvedValue({
      name: 'Empresa Sorriso',
      settings: settings
        ? {
            whatsappInstance: settings.whatsappInstance ?? null,
            whatsappOnboardingAnsweredAt:
              settings.whatsappOnboardingAnsweredAt ?? null,
          }
        : null,
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    env.API_PUBLIC_URL = 'https://api.exemplo.com';
    env.EVOLUTION_WEBHOOK_TOKEN = 'segredo-do-webhook';
    evolutionMock.isConfigured.mockReturnValue(true);
    prismaMock.clinicSettings.upsert.mockResolvedValue({});
    prismaMock.clinicSettings.updateMany.mockResolvedValue({ count: 1 });
    withClinic();

    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsappConnectionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EvolutionService, useValue: evolutionMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();
    connection = moduleRef.get(WhatsappConnectionService);
  });

  describe('nome da instância', () => {
    it('é derivado da empresa — nunca digitado por ninguém', () => {
      // Importa porque o nome da instância é o que o webhook usa para resolver
      // o tenant: aceitá-lo do cliente deixaria uma empresa sequestrar as
      // mensagens de outra.
      const name = connection.buildInstanceName(CLINIC, 'Clínica São José');
      expect(name).toBe('clinica-sao-jose-00000000');
    });

    it('é único por empresa mesmo com nomes iguais', () => {
      const a = connection.buildInstanceName(CLINIC, 'Sorriso');
      const b = connection.buildInstanceName(
        '11111111-1111-1111-1111-111111111111',
        'Sorriso',
      );
      expect(a).not.toBe(b);
    });

    it('empresa sem nome ainda gera um nome válido', () => {
      expect(connection.buildInstanceName(CLINIC, '   ')).toBe(
        'empresa-00000000',
      );
      expect(connection.buildInstanceName(CLINIC, '!!!')).toBe(
        'empresa-00000000',
      );
    });
  });

  describe('getStatus', () => {
    it('empresa sem instância: não configurado', async () => {
      const status = await connection.getStatus(CLINIC);

      expect(status.state).toBe('nao_configurado');
      expect(status.instanceName).toBeNull();
      expect(status.onboardingAnswered).toBe(false);
      expect(evolutionMock.connectionState).not.toHaveBeenCalled();
    });

    it('servidor sem Evolution configurada: avisa em vez de oferecer botão morto', async () => {
      evolutionMock.isConfigured.mockReturnValue(false);

      const status = await connection.getStatus(CLINIC);

      expect(status.serverReady).toBe(false);
    });

    it('sem API_PUBLIC_URL o pareamento não está disponível', async () => {
      env.API_PUBLIC_URL = undefined;

      const status = await connection.getStatus(CLINIC);

      expect(status.serverReady).toBe(false);
    });

    it('número pareado: conectado, com o telefone', async () => {
      withClinic({
        whatsappInstance: INSTANCE,
        whatsappOnboardingAnsweredAt: new Date(),
      });
      evolutionMock.connectionState.mockResolvedValue({
        instance: { instanceName: INSTANCE, state: 'open' },
      });
      evolutionMock.fetchInstance.mockResolvedValue([
        {
          instance: {
            instanceName: INSTANCE,
            ownerJid: '5511999998888@s.whatsapp.net',
          },
        },
      ]);

      const status = await connection.getStatus(CLINIC);

      expect(status.state).toBe('conectado');
      expect(status.phone).toBe('5511999998888');
      expect(status.onboardingAnswered).toBe(true);
    });

    it('sessão caída: desconectado', async () => {
      withClinic({ whatsappInstance: INSTANCE });
      evolutionMock.connectionState.mockResolvedValue({
        instance: { state: 'close' },
      });
      evolutionMock.fetchInstance.mockResolvedValue([]);

      expect((await connection.getStatus(CLINIC)).state).toBe('desconectado');
    });

    it('Evolution fora do ar: reporta desconectado com o motivo', async () => {
      // Dizer "conectado" quando não dá para saber seria pior do que admitir a
      // dúvida — o dono tomaria decisões achando que o bot está no ar.
      withClinic({ whatsappInstance: INSTANCE });
      evolutionMock.connectionState.mockRejectedValue(
        new Error('ECONNREFUSED'),
      );
      evolutionMock.fetchInstance.mockRejectedValue(new Error('ECONNREFUSED'));

      const status = await connection.getStatus(CLINIC);

      expect(status.state).toBe('desconectado');
      expect(status.lastError).toContain('ECONNREFUSED');
    });
  });

  describe('connect', () => {
    const qrPayload = {
      qrcode: { base64: 'data:image/png;base64,AAA', code: '2@abc' },
    };

    it('cria a instância já com o webhook apontado para a nossa API', async () => {
      evolutionMock.createInstance.mockResolvedValue(qrPayload);

      const result = await connection.connect(CLINIC);

      expect(evolutionMock.createInstance).toHaveBeenCalledWith(
        'empresa-sorriso-00000000',
        {
          url: 'https://api.exemplo.com/whatsapp/webhook',
          token: 'segredo-do-webhook',
        },
      );
      expect(result.state).toBe('aguardando_leitura');
      expect(result.qrCode).toBe('data:image/png;base64,AAA');
    });

    it('grava o vínculo instância → empresa e marca a pergunta como respondida', async () => {
      // Sem o vínculo, o número parearia e as mensagens não chegariam a lugar
      // nenhum: é ele que o webhook usa para achar o tenant.
      evolutionMock.createInstance.mockResolvedValue(qrPayload);

      await connection.connect(CLINIC);

      const call = prismaMock.clinicSettings.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ clinicId: CLINIC });
      expect(call.update.whatsappInstance).toBe('empresa-sorriso-00000000');
      expect(call.update.whatsappOnboardingAnsweredAt).toBeInstanceOf(Date);
    });

    it('instância já existente: pede QR novo em vez de recriar', async () => {
      withClinic({ whatsappInstance: INSTANCE });
      evolutionMock.connectionState.mockResolvedValue({ state: 'close' });
      evolutionMock.fetchInstance.mockResolvedValue([
        { instance: { instanceName: INSTANCE } },
      ]);
      evolutionMock.connectInstance.mockResolvedValue({
        base64: 'AAA',
        pairingCode: 'ABCD-1234',
      });

      const result = await connection.connect(CLINIC);

      expect(evolutionMock.createInstance).not.toHaveBeenCalled();
      expect(evolutionMock.connectInstance).toHaveBeenCalledWith(INSTANCE);
      // Base64 sem prefixo é normalizado para data URI (a tela usa em <img>).
      expect(result.qrCode).toBe('data:image/png;base64,AAA');
      expect(result.pairingCode).toBe('ABCD-1234');
    });

    it('já conectado: não recria nem pede QR', async () => {
      withClinic({ whatsappInstance: INSTANCE });
      evolutionMock.connectionState.mockResolvedValue({ state: 'open' });
      evolutionMock.fetchInstance.mockResolvedValue([]);

      const result = await connection.connect(CLINIC);

      expect(result.state).toBe('conectado');
      expect(evolutionMock.createInstance).not.toHaveBeenCalled();
      expect(evolutionMock.connectInstance).not.toHaveBeenCalled();
    });

    it('servidor sem Evolution: erro claro, não silêncio', async () => {
      evolutionMock.isConfigured.mockReturnValue(false);
      await expect(connection.connect(CLINIC)).rejects.toThrow(
        /EVOLUTION_API_URL/,
      );
    });

    it('sem URL pública da API: erro explicando o webhook', async () => {
      env.API_PUBLIC_URL = undefined;
      await expect(connection.connect(CLINIC)).rejects.toThrow(
        /API_PUBLIC_URL/,
      );
    });

    it('falha da Evolution vira mensagem acionável', async () => {
      evolutionMock.createInstance.mockRejectedValue(
        new Error('Evolution /instance/create respondeu 403'),
      );
      await expect(connection.connect(CLINIC)).rejects.toThrow(/403/);
    });
  });

  describe('pergunta do primeiro acesso', () => {
    it('"ainda não tenho número": registra e não pareia nada', async () => {
      // Quem respondeu isso não pode ser perguntado de novo a cada login.
      const result = await connection.answerOnboarding(CLINIC, 'nao_tem');

      expect(prismaMock.clinicSettings.upsert).toHaveBeenCalled();
      expect(evolutionMock.createInstance).not.toHaveBeenCalled();
      expect(result.state).toBe('nao_configurado');
    });

    it('"já tenho número": segue direto para o QR', async () => {
      evolutionMock.createInstance.mockResolvedValue({ base64: 'AAA' });

      const result = await connection.answerOnboarding(CLINIC, 'tem_numero');

      expect(evolutionMock.createInstance).toHaveBeenCalled();
      expect(result.state).toBe('aguardando_leitura');
    });
  });

  describe('desconectar e trocar de número', () => {
    it('desconectar mantém a instância (permite reparear)', async () => {
      withClinic({ whatsappInstance: INSTANCE });
      evolutionMock.connectionState.mockResolvedValue({ state: 'close' });
      evolutionMock.fetchInstance.mockResolvedValue([]);
      evolutionMock.logoutInstance.mockResolvedValue({});

      await connection.disconnect(CLINIC);

      expect(evolutionMock.logoutInstance).toHaveBeenCalledWith(INSTANCE);
      expect(evolutionMock.deleteInstance).not.toHaveBeenCalled();
      expect(prismaMock.clinicSettings.updateMany).not.toHaveBeenCalled();
    });

    it('sem WhatsApp conectado, desconectar é pedido inválido', async () => {
      await expect(connection.disconnect(CLINIC)).rejects.toThrow(
        /não tem WhatsApp conectado/,
      );
    });

    it('trocar de número remove a instância e desfaz o vínculo', async () => {
      withClinic({ whatsappInstance: INSTANCE });
      evolutionMock.deleteInstance.mockResolvedValue({});
      evolutionMock.connectionState.mockResolvedValue({ state: 'close' });
      evolutionMock.fetchInstance.mockResolvedValue([]);

      await connection.reset(CLINIC);

      expect(evolutionMock.deleteInstance).toHaveBeenCalledWith(INSTANCE);
      expect(prismaMock.clinicSettings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { whatsappInstance: null } }),
      );
    });

    it('instância já sumida da Evolution não impede limpar o nosso lado', async () => {
      withClinic({ whatsappInstance: INSTANCE });
      evolutionMock.deleteInstance.mockRejectedValue(new Error('404'));

      await expect(connection.reset(CLINIC)).resolves.toBeDefined();
      expect(prismaMock.clinicSettings.updateMany).toHaveBeenCalled();
    });
  });

  describe('leitura tolerante das respostas da Evolution', () => {
    it('encontra o QR na raiz ou aninhado', () => {
      expect(readQrCode({ base64: 'AAA' })).toBe('data:image/png;base64,AAA');
      expect(
        readQrCode({ qrcode: { base64: 'data:image/png;base64,BBB' } }),
      ).toBe('data:image/png;base64,BBB');
      expect(readQrCode({})).toBeNull();
    });

    it('lê o telefone das várias grafias e tira o sufixo de JID', () => {
      expect(
        readPhone({ instance: { ownerJid: '5511999998888@s.whatsapp.net' } }),
      ).toBe('5511999998888');
      expect(readPhone({ number: '55 11 99999-8888' })).toBe('5511999998888');
      expect(readPhone({})).toBeNull();
    });

    it('traduz o estado da Evolution', () => {
      expect(toConnectionState('open')).toBe('conectado');
      expect(toConnectionState('connecting')).toBe('aguardando_leitura');
      expect(toConnectionState('close')).toBe('desconectado');
      expect(toConnectionState(null)).toBe('desconectado');
    });
  });
});
