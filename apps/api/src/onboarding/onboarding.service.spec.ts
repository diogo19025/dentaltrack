import { Test } from "@nestjs/testing";
import { OnboardingService } from "./onboarding.service";
import { PrismaService } from "../prisma/prisma.service";

const USER_ID = "11111111-1111-1111-1111-111111111111";

describe("OnboardingService.ensureClinic", () => {
  let service: OnboardingService;
  const prismaMock = {
    membership: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [OnboardingService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(OnboardingService);
  });

  it("idempotente: já tem membership → devolve a clínica existente, sem criar nada", async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce({ clinicId: "clinic-existente" });

    const res = await service.ensureClinic({ userId: USER_ID });

    expect(res).toEqual({ clinicId: "clinic-existente", created: false });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("sem membership → cria clínica + membership (owner) em transação", async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce(null);
    const tx = {
      clinic: { create: jest.fn().mockResolvedValueOnce({ id: "clinic-novo", name: "Clínica Teste" }) },
      membership: { create: jest.fn().mockResolvedValueOnce({}) },
    };
    prismaMock.$transaction.mockImplementationOnce((cb: (t: typeof tx) => unknown) => cb(tx));

    const res = await service.ensureClinic({ userId: USER_ID, clinicName: "Clínica Teste" });

    expect(tx.clinic.create).toHaveBeenCalledWith({ data: { name: "Clínica Teste" } });
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, clinicId: "clinic-novo" },
    });
    expect(res).toEqual({ clinicId: "clinic-novo", created: true });
  });

  it("usa nome padrão quando não vem clinicName", async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce(null);
    const tx = {
      clinic: { create: jest.fn().mockResolvedValueOnce({ id: "c2", name: "Minha clínica" }) },
      membership: { create: jest.fn().mockResolvedValueOnce({}) },
    };
    prismaMock.$transaction.mockImplementationOnce((cb: (t: typeof tx) => unknown) => cb(tx));

    await service.ensureClinic({ userId: USER_ID });

    expect(tx.clinic.create).toHaveBeenCalledWith({ data: { name: "Minha clínica" } });
  });
});
