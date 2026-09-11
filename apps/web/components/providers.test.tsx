import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { shouldRetryRequest } from "./providers";

describe("shouldRetryRequest", () => {
  it("não repete erros 4xx", () => {
    expect(shouldRetryRequest(0, new ApiError(401, "Sessão expirada"))).toBe(false);
    expect(shouldRetryRequest(0, new ApiError(422, "Dados inválidos"))).toBe(false);
  });

  it("repete falhas transitórias, mas respeita o limite", () => {
    expect(shouldRetryRequest(0, new ApiError(503, "Fora do ar"))).toBe(true);
    expect(shouldRetryRequest(1, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryRequest(2, new TypeError("Failed to fetch"))).toBe(false);
  });
});
