import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { ProceduresService } from "./procedures.service";

const CLINIC_ID = "00000000-0000-0000-0000-0000000c1141";
const PROC_ID = "00000000-0000-0000-0000-00000000d001";

describe("ProceduresService", () => {
  let service: ProceduresService;
  const prismaMock = {
    procedure: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ProceduresService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(ProceduresService);
  });

  it("list escopa por clinicId e ordena por nome", async () => {
    prismaMock.procedure.findMany.mockResolvedValueOnce([]);
    await service.list(CLINIC_ID);
    expect(prismaMock.procedure.findMany).toHaveBeenCalledWith({
      where: { clinicId: CLINIC_ID },
      orderBy: { name: "asc" },
    });
  });

  it("create injeta o clinicId do tenant", async () => {
    prismaMock.procedure.create.mockResolvedValueOnce({ id: PROC_ID });
    await service.create(CLINIC_ID, { name: "Clareamento" });
    expect(prismaMock.procedure.create).toHaveBeenCalledWith({
      data: { clinicId: CLINIC_ID, name: "Clareamento" },
    });
  });

  it("update valida posse antes de gravar (404 quando não pertence à clínica)", async () => {
    prismaMock.procedure.findFirst.mockResolvedValueOnce(null);
    await expect(service.update(CLINIC_ID, PROC_ID, { name: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prismaMock.procedure.update).not.toHaveBeenCalled();
  });

  it("remove valida posse e apaga", async () => {
    prismaMock.procedure.findFirst.mockResolvedValueOnce({ id: PROC_ID });
    prismaMock.procedure.delete.mockResolvedValueOnce({ id: PROC_ID });
    const res = await service.remove(CLINIC_ID, PROC_ID);
    expect(res).toEqual({ id: PROC_ID });
    expect(prismaMock.procedure.delete).toHaveBeenCalledWith({ where: { id: PROC_ID } });
  });
});
