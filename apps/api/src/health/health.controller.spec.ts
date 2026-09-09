import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from '../whatsapp/evolution.service';

describe('HealthController', () => {
  let controller: HealthController;
  const prismaMock = { $queryRaw: jest.fn() };
  const evolutionMock = { isConfigured: jest.fn() };

  beforeEach(async () => {
    prismaMock.$queryRaw.mockReset();
    evolutionMock.isConfigured.mockReset().mockReturnValue(false);
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prismaMock },
        { provide: EvolutionService, useValue: evolutionMock },
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
