import { describe, expect, it } from "vitest";
import { whatsappUrl } from "./whatsapp";

describe("whatsappUrl", () => {
  it("monta o wa.me com DDI 55 para telefone BR sem DDI", () => {
    expect(whatsappUrl("(11) 90000-0000")).toBe("https://wa.me/5511900000000");
  });

  it("preserva o número que já tem DDI", () => {
    expect(whatsappUrl("+55 (11) 98888-7777")).toBe("https://wa.me/5511988887777");
  });

  it("aceita fixo de 10 dígitos (DDD + número)", () => {
    expect(whatsappUrl("11 3333-4444")).toBe("https://wa.me/551133334444");
  });

  it("retorna null sem telefone ou com número curto demais", () => {
    expect(whatsappUrl(null)).toBeNull();
    expect(whatsappUrl(undefined)).toBeNull();
    expect(whatsappUrl("9999")).toBeNull();
  });
});
