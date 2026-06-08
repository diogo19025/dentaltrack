import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { ProceduresService } from "./procedures.service";

const CLINIC_ID = "00000000-0000-0000-0000-0000000c1141";
const PROC_ID = "00000000-0000-0000-0000-00000000d001";
const TAG_ID = "00000000-0000-0000-0000-00000000e001";

const WITH_TAGS = { tags: { select: { id: true } } };

/** Linha do banco (escalares + tags) usada nos mocks. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: PROC_ID,
    name: "Clareamento",
    description: null,
    priceMinCents: null,
    priceMaxCents: null,
    durationMinutes: null,
    active: true,
    tags: [] as { id: string }[],
    ...over,
  };
}

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
    tag: { count: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ProceduresService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(ProceduresService);
  });

  it("list escopa por clinicId, ordena por nome e inclui as tags", async () => {
    prismaMock.procedure.findMany.mockResolvedValueOnce([row({ tags: [{ id: TAG_ID }] })]);
    const res = await service.list(CLINIC_ID);
    expect(prismaMock.procedure.findMany).toHaveBeenCalledWith({
      where: { clinicId: CLINIC_ID },
      orderBy: { name: "asc" },
      include: WITH_TAGS,
    });
    expect(res[0].tagIds).toEqual([TAG_ID]);
  });

  it("create injeta o clinicId do tenant (sem tags não consulta count)", async () => {
    prismaMock.procedure.create.mockResolvedValueOnce(row());
    const res = await service.create(CLINIC_ID, { name: "Clareamento" });
    expect(prismaMock.procedure.create).toHaveBeenCalledWith({
      data: { clinicId: CLINIC_ID, name: "Clareamento" },
      include: WITH_TAGS,
    });
    expect(prismaMock.tag.count).not.toHaveBeenCalled();
    expect(res.tagIds).toEqual([]);
  });

  it("create conecta as tags informadas após validar posse", async () => {
    prismaMock.tag.count.mockResolvedValueOnce(1);
    prismaMock.procedure.create.mockResolvedValueOnce(row({ tags: [{ id: TAG_ID }] }));
    await service.create(CLINIC_ID, { name: "X", tagIds: [TAG_ID] });
    expect(prismaMock.tag.count).toHaveBeenCalledWith({
      where: { clinicId: CLINIC_ID, id: { in: [TAG_ID] } },
    });
    expect(prismaMock.procedure.create).toHaveBeenCalledWith({
      data: { clinicId: CLINIC_ID, name: "X", tags: { connect: [{ id: TAG_ID }] } },
      include: WITH_TAGS,
    });
  });

  it("create rejeita tag de outra clínica (400) sem gravar", async () => {
    prismaMock.tag.count.mockResolvedValueOnce(0); // nenhuma das tags pertence à clínica
    await expect(
      service.create(CLINIC_ID, { name: "X", tagIds: [TAG_ID] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.procedure.create).not.toHaveBeenCalled();
  });

  it("update valida posse antes de gravar (404 quando não pertence à clínica)", async () => {
    prismaMock.procedure.findFirst.mockResolvedValueOnce(null);
    await expect(service.update(CLINIC_ID, PROC_ID, { name: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prismaMock.procedure.update).not.toHaveBeenCalled();
  });

  it("update substitui o conjunto de tags (set) quando enviado", async () => {
    prismaMock.procedure.findFirst.mockResolvedValueOnce({ id: PROC_ID });
    prismaMock.tag.count.mockResolvedValueOnce(1);
    prismaMock.procedure.update.mockResolvedValueOnce(row({ tags: [{ id: TAG_ID }] }));
    await service.update(CLINIC_ID, PROC_ID, { tagIds: [TAG_ID] });
    expect(prismaMock.procedure.update).toHaveBeenCalledWith({
      where: { id: PROC_ID },
      data: { tags: { set: [{ id: TAG_ID }] } },
      include: WITH_TAGS,
    });
  });

  it("remove valida posse e apaga", async () => {
    prismaMock.procedure.findFirst.mockResolvedValueOnce({ id: PROC_ID });
    prismaMock.procedure.delete.mockResolvedValueOnce({ id: PROC_ID });
    const res = await service.remove(CLINIC_ID, PROC_ID);
    expect(res).toEqual({ id: PROC_ID });
    expect(prismaMock.procedure.delete).toHaveBeenCalledWith({ where: { id: PROC_ID } });
  });
});
