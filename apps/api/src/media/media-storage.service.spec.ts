import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MediaStorageService } from './media-storage.service';

const SUPABASE_URL = 'https://projeto.supabase.co';
const SERVICE_KEY = 'service-role-key';
const CLINIC = '00000000-0000-0000-0000-0000000c1141';

function png(bytes = 1024): Buffer {
  return Buffer.alloc(bytes, 1);
}

function ok(status = 200, body = ''): Response {
  return new Response(body, { status });
}

describe('MediaStorageService (armazenamento de arquivo · F13)', () => {
  let fetchMock: jest.SpyInstance;

  /** Env mínimo: sem a service key o serviço se declara não configurado. */
  function setup(env: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      ...env,
    };
    const config = { get: (key: string) => values[key] };
    return Test.createTestingModule({
      providers: [
        MediaStorageService,
        { provide: ConfigService, useValue: config },
      ],
    })
      .compile()
      .then((ref) => ref.get(MediaStorageService));
  }

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('validação — antes de gastar rede', () => {
    it('recusa formato que o WhatsApp não entrega', async () => {
      const service = await setup();

      await expect(
        service.upload({
          clinicId: CLINIC,
          purpose: 'oferta',
          mimetype: 'image/tiff',
          buffer: png(),
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('recusa SVG na logo — é XML que pode conter script', async () => {
      const service = await setup();

      await expect(
        service.upload({
          clinicId: CLINIC,
          purpose: 'logo',
          mimetype: 'image/svg+xml',
          buffer: png(),
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('recusa logo acima de 1 MB com o tamanho na mensagem', async () => {
      const service = await setup();

      await expect(
        service.upload({
          clinicId: CLINIC,
          purpose: 'logo',
          mimetype: 'image/png',
          buffer: png(2 * 1024 * 1024),
        }),
      ).rejects.toMatchObject({ status: 413 });
    });

    it('o mesmo arquivo de 2 MB passa como mídia de oferta', async () => {
      const service = await setup();
      fetchMock.mockResolvedValue(ok());

      const result = await service.upload({
        clinicId: CLINIC,
        purpose: 'oferta',
        mimetype: 'image/png',
        buffer: png(2 * 1024 * 1024),
      });

      expect(result.type).toBe('image');
    });

    it('recusa arquivo vazio', async () => {
      const service = await setup();

      await expect(
        service.upload({
          clinicId: CLINIC,
          purpose: 'logo',
          mimetype: 'image/png',
          buffer: Buffer.alloc(0),
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('o MIME manda, não a extensão do nome enviado pelo navegador', async () => {
      const service = await setup();
      fetchMock.mockResolvedValue(ok());

      const result = await service.upload({
        clinicId: CLINIC,
        purpose: 'oferta',
        originalName: 'promo.png',
        mimetype: 'application/pdf',
        buffer: png(),
      });

      // O nome dizia imagem; o conteúdo é PDF, e é o conteúdo que decide o
      // tipo que a tela vai mostrar e que a Evolution vai usar no envio.
      expect(result.type).toBe('document');
      expect(result.url).toMatch(/\.pdf$/);
    });
  });

  describe('ambiente sem storage', () => {
    it('explica o que falta em vez de estourar', async () => {
      const service = await setup({ SUPABASE_SERVICE_ROLE_KEY: undefined });

      await expect(
        service.upload({
          clinicId: CLINIC,
          purpose: 'logo',
          mimetype: 'image/png',
          buffer: png(),
        }),
      ).rejects.toMatchObject({ status: 503 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('`isConfigured` responde sem tocar na rede', async () => {
      const service = await setup({ SUPABASE_SERVICE_ROLE_KEY: undefined });
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('gravação', () => {
    it('cria o bucket, sobe o objeto e devolve a URL pública', async () => {
      const service = await setup();
      fetchMock.mockResolvedValue(ok());

      const result = await service.upload({
        clinicId: CLINIC,
        purpose: 'logo',
        originalName: 'logo.png',
        mimetype: 'image/png',
        buffer: png(),
      });

      const [bucketUrl, bucketInit] = fetchMock.mock.calls[0];
      expect(String(bucketUrl)).toBe(`${SUPABASE_URL}/storage/v1/bucket`);
      expect(JSON.parse(String(bucketInit.body)).public).toBe(true);

      const [objectUrl, objectInit] = fetchMock.mock.calls[1];
      // Caminho escopado pela empresa — nunca por valor vindo do cliente.
      expect(String(objectUrl)).toContain(
        `/storage/v1/object/media/${CLINIC}/logo/`,
      );
      expect(objectInit.headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
      expect(objectInit.headers['Content-Type']).toBe('image/png');

      expect(result.url).toContain('/storage/v1/object/public/media/');
      expect(result.url).toMatch(/\.png$/);
      expect(result.fileName).toBe('logo.png');
    });

    it('bucket que já existe (409) não é erro', async () => {
      const service = await setup();
      fetchMock
        .mockResolvedValueOnce(ok(409, 'Duplicate'))
        .mockResolvedValueOnce(ok());

      await expect(
        service.upload({
          clinicId: CLINIC,
          purpose: 'logo',
          mimetype: 'image/png',
          buffer: png(),
        }),
      ).resolves.toMatchObject({ type: 'image' });
    });

    it('confirmado o bucket, o upload seguinte não o cria de novo', async () => {
      const service = await setup();
      fetchMock.mockResolvedValue(ok());
      const file = {
        clinicId: CLINIC,
        purpose: 'logo' as const,
        mimetype: 'image/png',
        buffer: png(),
      };

      await service.upload(file);
      const afterFirst = fetchMock.mock.calls.length;
      await service.upload(file);

      // Primeiro upload: bucket + objeto. Segundo: só o objeto.
      expect(afterFirst).toBe(2);
      expect(fetchMock.mock.calls.length).toBe(3);
    });

    it('falha do storage vira 503 com o status no corpo, não 500 mudo', async () => {
      const service = await setup();
      fetchMock
        .mockResolvedValueOnce(ok())
        .mockResolvedValueOnce(ok(500, 'boom'));

      await expect(
        service.upload({
          clinicId: CLINIC,
          purpose: 'logo',
          mimetype: 'image/png',
          buffer: png(),
        }),
      ).rejects.toMatchObject({ status: 503 });
    });

    it('**não repete** a escrita — é assim que se cria arquivo órfão', async () => {
      const service = await setup();
      fetchMock
        .mockResolvedValueOnce(ok())
        .mockResolvedValueOnce(ok(500, 'boom'));

      await service
        .upload({
          clinicId: CLINIC,
          purpose: 'logo',
          mimetype: 'image/png',
          buffer: png(),
        })
        .catch(() => undefined);

      // Bucket + uma tentativa de objeto. Nada além disso.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rede fora vira 503 com mensagem de gente', async () => {
      const service = await setup();
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.upload({
          clinicId: CLINIC,
          purpose: 'logo',
          mimetype: 'image/png',
          buffer: png(),
        }),
      ).rejects.toMatchObject({ status: 503 });
    });
  });
});
