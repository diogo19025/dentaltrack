import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatCaptured, initials, sourceLabel, timeAgo } from "./format";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-09T12:00:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("timeAgo", () => {
  it("retorna — para null", () => {
    expect(timeAgo(null)).toBe("—");
  });

  it("retorna 'agora' para menos de 1 minuto", () => {
    expect(timeAgo(new Date("2026-06-09T11:59:30").toISOString())).toBe("agora");
  });

  it("retorna minutos para menos de 1 hora", () => {
    expect(timeAgo(new Date("2026-06-09T11:48:00").toISOString())).toBe("há 12 min");
  });

  it("retorna horas para menos de 1 dia", () => {
    expect(timeAgo(new Date("2026-06-09T10:00:00").toISOString())).toBe("há 2 h");
  });

  it("retorna 'ontem' para 1 dia", () => {
    expect(timeAgo(new Date("2026-06-08T11:00:00").toISOString())).toBe("ontem");
  });

  it("retorna dias para menos de 1 semana", () => {
    expect(timeAgo(new Date("2026-06-06T12:00:00").toISOString())).toBe("há 3 dias");
  });

  it("retorna data pt-BR para 7 dias ou mais", () => {
    expect(timeAgo(new Date("2026-05-09T12:00:00").toISOString())).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe("formatCaptured", () => {
  it("hoje vira 'Hoje, HH:MM'", () => {
    expect(formatCaptured(new Date("2026-06-09T09:30:00").toISOString())).toBe("Hoje, 09:30");
  });

  it("ontem vira 'Ontem, HH:MM'", () => {
    expect(formatCaptured(new Date("2026-06-08T19:40:00").toISOString())).toBe("Ontem, 19:40");
  });

  it("menos de 7 dias vira 'N dias atrás'", () => {
    expect(formatCaptured(new Date("2026-06-06T15:00:00").toISOString())).toBe("3 dias atrás");
  });

  it("7 dias ou mais vira data pt-BR", () => {
    expect(formatCaptured(new Date("2026-05-20T15:00:00").toISOString())).toMatch(
      /^\d{2}\/\d{2}\/\d{4}$/,
    );
  });
});

describe("initials", () => {
  it("duas primeiras iniciais, maiúsculas", () => {
    expect(initials("ana souza")).toBe("AS");
  });

  it("limita a 2 palavras", () => {
    expect(initials("Ana Maria Souza")).toBe("AM");
  });

  it("nome único vira 1 letra", () => {
    expect(initials("Ana")).toBe("A");
  });

  it("null/vazio usa o fallback", () => {
    expect(initials(null)).toBe("?");
    expect(initials("   ")).toBe("?");
    expect(initials(undefined, "•")).toBe("•");
  });
});

describe("sourceLabel", () => {
  it("traduz as origens conhecidas", () => {
    expect(sourceLabel("web")).toBe("Web");
    expect(sourceLabel("whatsapp")).toBe("WhatsApp");
    expect(sourceLabel("manual")).toBe("Manual");
    expect(sourceLabel("import")).toBe("Importado");
  });

  it("origem desconhecida passa direto", () => {
    expect(sourceLabel("outro")).toBe("outro");
  });
});
