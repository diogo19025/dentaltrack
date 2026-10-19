import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  decryptSecret,
  loadEncryptionKey,
} from '../clinicorp/credentials-crypto';
import { MetaConnectionService } from './meta-connection.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const KEY = 'a'.repeat(64);
const INPUT = {
  phoneNumberId: '1055',
  wabaId: '2077',
  accessToken: 'EAAtoken-longo-o-bastante-123',
};

describe('MetaConnectionService', () => {
  const prisma = {
    clinicSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const env: Record<string, string | undefined> = {};
  let service: MetaConnectionService;
  const realFetch = global.fetch;

  const metaAnswers = (ok: boolean) => {
    const body = ok
      ? { display_phone_number: '+55 11 99999-8888', verified_name: 'Sorriso' }
      : { error: { message: 'Invalid OAuth access token', code: 190 } };
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok,
        status: ok ? 200 : 401,
        json: () => Promise.resolve(body),
      }),
    ) as unknown as typeof fetch;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(env, {
      META_APP_SECRET: 's',
      META_WEBHOOK_VERIFY_TOKEN: 'v',
      INTEGRATION_ENCRYPTION_KEY: KEY,
      API_PUBLIC_URL: 'https://api.exemplo.com',
    });
    prisma.clinicSettings.findUnique.mockResolvedValue(null);
    prisma.clinicSettings.upsert.mockResolvedValue({});
    service = new MetaConnectionService(
      prisma as never,
      { get: (k: string) => env[k] } as never,
    );
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('salva só depois de a Meta aceitar, com o token cifrado — nunca em texto puro', async () => {
    metaAnswers(true);

    await service.save(CLINIC, INPUT);

    const data = prisma.clinicSettings.upsert.mock.calls[0][0].update as Record<
      string,
      string
    >;
    // Salvar não troca o provedor: a escolha é explícita (setProvider).
    expect(data).not.toHaveProperty('whatsappProvider');
    expect(data).toMatchObject({
      metaPhoneNumberId: '1055',
      metaWabaId: '2077',
      metaDisplayPhone: '+55 11 99999-8888',
    });
    expect(JSON.stringify(data)).not.toContain(INPUT.accessToken);
    expect(decryptSecret(data.metaAccessTokenEnc, loadEncryptionKey(KEY))).toBe(
      INPUT.accessToken,
    );
  });

  it('credencial recusada pela Meta: 400 com o motivo, e nada é gravado', async () => {
    metaAnswers(false);

    await expect(service.save(CLINIC, INPUT)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.clinicSettings.upsert).not.toHaveBeenCalled();
  });

  it('número já usado por outra empresa: 409', async () => {
    metaAnswers(true);
    prisma.clinicSettings.upsert.mockRejectedValue({ code: 'P2002' });

    await expect(service.save(CLINIC, INPUT)).rejects.toThrow(
      ConflictException,
    );
  });

  it('servidor sem segredo/chave: 503 antes de falar com a Meta', async () => {
    env.META_APP_SECRET = undefined;
    global.fetch = jest.fn();

    await expect(service.save(CLINIC, INPUT)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('status nunca devolve o token; remover volta ao provedor Evolution', async () => {
    prisma.clinicSettings.findUnique.mockResolvedValue({
      whatsappProvider: 'meta',
      metaPhoneNumberId: '1055',
      metaWabaId: '2077',
      metaAccessTokenEnc: 'v1.x.y.z',
      metaDisplayPhone: null,
      metaVerifiedName: null,
    });

    const status = await service.getStatus(CLINIC);
    expect(status).toMatchObject({
      provider: 'meta',
      tokenSaved: true,
      webhookUrl: 'https://api.exemplo.com/whatsapp/meta/webhook',
    });
    expect(JSON.stringify(status)).not.toContain('v1.x.y.z');

    await service.remove(CLINIC);
    expect(
      prisma.clinicSettings.updateMany.mock.calls[0][0].data,
    ).toMatchObject({
      whatsappProvider: 'evolution',
      metaAccessTokenEnc: null,
      metaPhoneNumberId: null,
    });
  });

  it('ativar a Meta sem credencial salva: 422 e nada muda', async () => {
    prisma.clinicSettings.findUnique.mockResolvedValue({
      metaPhoneNumberId: null,
      metaAccessTokenEnc: null,
    });

    await expect(service.setProvider(CLINIC, 'meta')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(prisma.clinicSettings.upsert).not.toHaveBeenCalled();
  });

  it('escolhe o provedor ativo sem apagar a configuração do outro', async () => {
    prisma.clinicSettings.findUnique.mockResolvedValue({
      whatsappProvider: 'evolution',
      metaPhoneNumberId: '1055',
      metaWabaId: '2077',
      metaAccessTokenEnc: 'v1.x.y.z',
      metaDisplayPhone: null,
      metaVerifiedName: null,
    });

    await service.setProvider(CLINIC, 'meta');
    expect(prisma.clinicSettings.upsert.mock.calls[0][0].update).toEqual({
      whatsappProvider: 'meta',
    });

    await service.setProvider(CLINIC, 'evolution');
    expect(prisma.clinicSettings.upsert.mock.calls[1][0].update).toEqual({
      whatsappProvider: 'evolution',
    });
  });
});
