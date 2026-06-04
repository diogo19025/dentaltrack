import { Test } from "@nestjs/testing";
import { HealthController } from "./health.controller";
import { PrismaService } from "../prisma/prisma.service";

describe("HealthController", () => {
  let controller: HealthController;
  const prismaMock = { $queryRaw: jest.fn() };

  beforeEach(async () => {
    prismaMock.$queryRaw.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prismaMock }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('retorna status "ok" e db "up" quando o banco responde', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    const res = await controller.check();
    expect(res.status).toBe("ok");
    expect(res.db).toBe("up");
    expect(typeof res.timestamp).toBe("string");
  });

  it('retorna db "down" quando a query falha', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error("sem conexão"));
    const res = await controller.check();
    expect(res.db).toBe("down");
  });
});
