import type { Clinic, ClinicSettings, Procedure } from "../../generated/prisma/client";
import { buildSystemPrompt } from "./prompt";

const NOW = new Date("2026-06-05T00:00:00.000Z");

function makeClinic(over: Partial<Clinic> = {}): Clinic {
  return { id: "c1", name: "Clínica Sorriso", createdAt: NOW, updatedAt: NOW, ...over };
}

function makeSettings(over: Partial<ClinicSettings> = {}): ClinicSettings {
  return {
    id: "s1",
    clinicId: "c1",
    specialty: null,
    description: null,
    assistantName: null,
    tone: null,
    greeting: null,
    instructions: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeProcedure(over: Partial<Procedure> = {}): Procedure {
  return {
    id: "p1",
    clinicId: "c1",
    name: "Implante",
    description: "Reposição de dente",
    priceMinCents: 150000,
    priceMaxCents: 350000,
    durationMinutes: 90,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe("buildSystemPrompt", () => {
  it("inclui o nome da clínica", () => {
    const prompt = buildSystemPrompt({ clinic: makeClinic(), procedures: [] });
    expect(prompt).toContain("Clínica Sorriso");
  });

  it("inclui especialidade, persona, saudação e instruções quando há settings", () => {
    const prompt = buildSystemPrompt({
      clinic: makeClinic(),
      settings: makeSettings({
        specialty: "ortodontia e implantes",
        assistantName: "Sofia",
        tone: "acolhedor",
        greeting: "Olá! Como posso ajudar seu sorriso hoje?",
        instructions: "Sempre ofereça a avaliação gratuita de junho.",
      }),
      procedures: [],
    });
    expect(prompt).toContain("ortodontia e implantes");
    expect(prompt).toContain("Sofia");
    expect(prompt).toContain("acolhedor");
    expect(prompt).toContain("Olá! Como posso ajudar seu sorriso hoje?");
    expect(prompt).toContain("avaliação gratuita de junho");
  });

  it("inclui os procedimentos cadastrados com faixa de preço e duração", () => {
    const prompt = buildSystemPrompt({
      clinic: makeClinic(),
      procedures: [
        makeProcedure({ name: "Clareamento", priceMinCents: 50000, priceMaxCents: 120000, durationMinutes: 60 }),
        makeProcedure({ id: "p2", name: "Limpeza", priceMinCents: 15000, priceMaxCents: 15000, durationMinutes: 45 }),
      ],
    });
    expect(prompt).toContain("Clareamento");
    expect(prompt).toContain("Limpeza");
    expect(prompt).toContain("R$");
    expect(prompt).toMatch(/duração: ~60 min/);
  });

  it("funciona sem settings (undefined e null)", () => {
    const semSettings = buildSystemPrompt({ clinic: makeClinic(), procedures: [makeProcedure()] });
    const settingsNull = buildSystemPrompt({ clinic: makeClinic(), settings: null, procedures: [] });
    expect(semSettings).toContain("Clínica Sorriso");
    expect(settingsNull).toContain("Clínica Sorriso");
    // não deve vazar "undefined"/"null" no texto.
    expect(semSettings).not.toMatch(/undefined|null/);
    expect(settingsNull).not.toMatch(/undefined|null/);
  });

  it("funciona sem procedimentos (lista vazia)", () => {
    const prompt = buildSystemPrompt({ clinic: makeClinic(), procedures: [] });
    expect(prompt).toContain("ainda não cadastrou procedimentos");
  });

  it("inclui as diretrizes-chave (lead nome+telefone e não inventar preços)", () => {
    const prompt = buildSystemPrompt({ clinic: makeClinic(), procedures: [makeProcedure()] });
    expect(prompt).toContain("nome e o telefone");
    expect(prompt).toContain("Não invente preços");
  });
});
