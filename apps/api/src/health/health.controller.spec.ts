import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { MediaStorageService } from '../media/media-storage.service';
import { EvolutionService } from '../whatsapp/evolution.service';

describe('HealthController', () => {
  let controller: HealthController;
  const prismaMock = { $queryRaw: jest.fn() };
  const evolutionMock = { isConfigured: jest.fn() };
  const mediaMock = { isConfigured: jest.fn() };

  beforeEach(async () => {
    prismaMock.$queryRaw.mockReset();
    evolutionMock.isConfigured.mockReset().mockReturnValue(false);
    mediaMock.isConfigured.mockReset().mockReturnValue(false);
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prismaMock },
        { provide: EvolutionService, useValue: evolutionMock },
        { provide: MediaStorageService, useValue: mediaMock },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('retorna status "ok" e db "up" quando o banco responde', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    const res = await controller.check();
    expect(res.status).toBe('ok');
    expect(res.db).toBe('up');
    expect(typeof res.timestamp).toBe('string');
  });

  it('retorna db "down" quando a query falha', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('sem conexão'));
    const res = await controller.check();
    expect(res.db).toBe('down');
  });

  // O healthcheck do Railway bate a cada poucos segundos: se ele chamasse a
  // Evolution, o serviço inteiro cairia junto com o WhatsApp — quando na verdade
  // o produto segue funcionando para todo o resto.
  it('reporta o transporte do WhatsApp sem chamar a Evolution', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    evolutionMock.isConfigured.mockReturnValue(true);

    const res = await controller.check();

    expect(res.whatsapp).toBe('configurado');
    expect(evolutionMock.isConfigured).toHaveBeenCalledTimes(1);
  });

  // A falta da SUPABASE_SERVICE_ROLE_KEY é silenciosa: a API sobe igual e só
  // quem clica em "Enviar logo" descobre, pelo 503. O /health passa a dizer.
  it('reporta se o envio de arquivos está configurado', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1 }]);

    expect((await controller.check()).arquivos).toBe('nao_configurado');

    mediaMock.isConfigured.mockReturnValue(true);
    expect((await controller.check()).arquivos).toBe('configurado');
  });

  // `APP_VERSION=${{ RAILWAY_GIT_COMMIT_SHA }}` chega vazia quando a referência
  // não resolve. "" parece configurado e não é — vira `null`.
  it('APP_VERSION vazia é null, não string vazia', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    const original = process.env.APP_VERSION;
    process.env.APP_VERSION = '';
    try {
      expect((await controller.check()).version).toBeNull();
      process.env.APP_VERSION = '   ';
      expect((await controller.check()).version).toBeNull();
    } finally {
      if (original === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = original;
    }
  });

  it('identifica o deploy publicado (P0.3)', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    const original = process.env.APP_VERSION;
    process.env.APP_VERSION = 'abc1234';
    try {
      expect((await controller.check()).version).toBe('abc1234');
    } finally {
      if (original === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = original;
    }
  });

  it('reporta o monitoramento desligado quando não há DSN', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    expect((await controller.check()).monitoramento).toBe('desligado');
  });
});
