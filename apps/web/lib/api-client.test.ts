import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "./api-client";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession } }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  getSession.mockResolvedValue({ data: { session: { access_token: "jwt-123" } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("apiFetch", () => {
  it("anexa o Bearer do Supabase e o Content-Type, e devolve o JSON", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const data = await apiFetch<{ ok: boolean }>("/health");

    expect(data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/health");
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer jwt-123");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("sem sessão, não envia Authorization", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await apiFetch("/health");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get("Authorization")).toBeNull();
  });

  it("resposta !ok vira ApiError com status e corpo", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "IA indisponível",
    });

    const err = await apiFetch("/chat").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).message).toBe("IA indisponível");
  });

  it("usa o statusText quando o corpo do erro está vazio", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    });

    const err = await apiFetch("/nada").catch((e: unknown) => e);

    expect((err as ApiError).message).toBe("Not Found");
  });
});
