import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DEFAULT_AVAILABILITY } from "@dentaltrack/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "./settings.service";

const CLINIC_ID = "00000000-0000-0000-0000-0000000c1141";
const NOW = new Date("2026-06-07T00:00:00.000Z");

function makeClinic(over = {}) {
  return { id: CLINIC_ID, name: "Clínica Demo", createdAt: NOW, updatedAt: NOW, ...over };
}

describe("SettingsService", () => {
  let service: SettingsService;
  const prismaMock = {
    clinic: { findUnique: jest.fn(), update: jest.fn() },
    clinicSettings: { upsert: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [SettingsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(SettingsService);
  });

  it("getSettings preenche defaults quando não há linha de settings", async () => {
    prismaMock.clinic.findUnique.mockResolvedValueOnce({ ...makeClinic(), settings: null });

    const dto = await service.getSettings(CLINIC_ID);

    expect(dto.clinicName).toBe("Clínica Demo");
    expect(dto.tone).toBe("amigavel");
    expect(dto.specialty).toBe("");
    expect(dto.offerEnabled).toBe(false);
    expect(dto.availability).toEqual(DEFAULT_AVAILABILITY);
  });

  it("getSettings lança 404 quando a clínica não existe", async () => {
    prismaMock.clinic.findUnique.mockResolvedValueOnce(null);
    await expect(service.getSettings(CLINIC_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("updateSettings grava o nome na clínica e o restante em settings (upsert)", async () => {
    prismaMock.clinic.findUnique.mockResolvedValueOnce(makeClinic());
    const updatedClinic = makeClinic({ name: "Novo Nome" });
    const settingsRow = {
      id: "s1",
      clinicId: CLINIC_ID,
      specialty: null,
      description: null,
      assistantName: "Sofia",
      tone: "acolhedor",
      greeting: null,
      instructions: null,
      offerEnabled: true,
      offerText: "Avaliação grátis",
      offerStartsOn: null,
      offerEndsOn: null,
      availability: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    prismaMock.$transaction.mockResolvedValueOnce([updatedClinic, settingsRow]);

    const dto = await service.updateSettings(CLINIC_ID, {
      clinicName: "Novo Nome",
      assistantName: "Sofia",
      tone: "acolhedor",
      offerEnabled: true,
      offerText: "Avaliação grátis",
    });

    expect(prismaMock.clinic.update).toHaveBeenCalledWith({
      where: { id: CLINIC_ID },
      data: { name: "Novo Nome" },
    });
    expect(prismaMock.clinicSettings.upsert).toHaveBeenCalled();
    expect(dto.clinicName).toBe("Novo Nome");
    expect(dto.assistantName).toBe("Sofia");
    expect(dto.offerEnabled).toBe(true);
  });
});
