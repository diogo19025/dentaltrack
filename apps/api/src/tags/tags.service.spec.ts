import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TagsService } from "./tags.service";

const CLINIC_ID = "00000000-0000-0000-0000-0000000c1141";
const TAG_ID = "00000000-0000-0000-0000-00000000e001";

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique", {
    code: "P2002",
    clientVersion: "7.0.0",
  });
}

describe("TagsService", () => {
  let service: TagsService;
  const prismaMock = {
    tag: {
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
      providers: [TagsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(TagsService);
  });

  it("create injeta o clinicId do tenant", async () => {
    prismaMock.tag.create.mockResolvedValueOnce({ id: TAG_ID });
    await service.create(CLINIC_ID, { name: "Implante", color: "teal", keywords: ["implante"] });
    expect(prismaMock.tag.create).toHaveBeenCalledWith({
      data: { clinicId: CLINIC_ID, name: "Implante", color: "teal", keywords: ["implante"] },
    });
  });

  it("create traduz nome duplicado (P2002) em 409", async () => {
    prismaMock.tag.create.mockRejectedValueOnce(p2002());
    await expect(service.create(CLINIC_ID, { name: "Implante" })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("update valida posse antes de gravar (404 cross-tenant)", async () => {
    prismaMock.tag.findFirst.mockResolvedValueOnce(null);
    await expect(service.update(CLINIC_ID, TAG_ID, { name: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prismaMock.tag.update).not.toHaveBeenCalled();
  });

  it("remove valida posse e apaga", async () => {
    prismaMock.tag.findFirst.mockResolvedValueOnce({ id: TAG_ID });
    prismaMock.tag.delete.mockResolvedValueOnce({ id: TAG_ID });
    const res = await service.remove(CLINIC_ID, TAG_ID);
    expect(res).toEqual({ id: TAG_ID });
  });
});
