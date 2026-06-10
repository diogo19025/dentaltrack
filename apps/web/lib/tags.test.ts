import { describe, expect, it } from "vitest";
import { tagClass } from "./tags";

describe("tagClass", () => {
  it.each([
    ["implante", "tag-teal"],
    ["faceta de porcelana", "tag-violet"],
    ["clareamento", "tag-amber"],
    ["ortodontia", "tag-blue"],
    ["urgência", "tag-rose"],
    ["limpeza", "tag-sage"],
  ])("mapeia %s → %s (fixo do design)", (name, expected) => {
    expect(tagClass(name)).toBe(expected);
  });

  it("é case-insensitive", () => {
    expect(tagClass("Implante")).toBe("tag-teal");
  });

  it("tag desconhecida cai no default teal", () => {
    expect(tagClass("tag-inexistente")).toBe("tag-teal");
  });
});
