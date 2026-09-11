import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_TIMEOUT_MS, ApiError, apiFetch } from "./api-client";

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("apiFetch", () => {
  it("anexa Bearer, Content-Type e requestId, e devolve o JSON", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const data = await apiFetch<{ ok: boolean }>("/health");

    expect(data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/health");
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer jwt-123");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("x-request-id")).toMatch(/\S+/);
  });

  it("sem sessão, não envia Authorization", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    await apiFetch("/health");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get("Authorization")).toBeNull();
  });

  it("aceita 204 sem tentar interpretar um JSON inexistente", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      apiFetch<void>("/resource", { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });

  it("resposta !ok vira ApiError com status, corpo e requestId", async () => {
    fetchMock.mockResolvedValue(
      new Response("IA indisponível", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    const err = await apiFetch("/chat").catch((e: unknown) => e);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentRequestId = (init.headers as Headers).get("x-request-id");

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).message).toBe("IA indisponível");
    expect((err as ApiError).requestId).toBe(sentRequestId);
  });

  it("prefere o requestId devolvido pela API", async () => {
    fetchMock.mockResolvedValue(
      new Response("Falha", {
        status: 500,
        headers: { "x-request-id": "server-request-id" },
      }),
    );

    const err = await apiFetch("/chat").catch((e: unknown) => e);

    expect((err as ApiError).requestId).toBe("server-request-id");
  });

  it("usa o statusText quando o corpo do erro está vazio", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 404, statusText: "Not Found" }),
    );

    const err = await apiFetch("/nada").catch((e: unknown) => e);

    expect((err as ApiError).message).toBe("Not Found");
  });

  it("aborta no timeout e preserva o requestId no erro", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const pending = apiFetch("/lento").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestId = (init.headers as Headers).get("x-request-id");
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);

    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).requestId).toBe(requestId);
    expect((err as ApiError).message).toMatch(/15 segundos/i);
  });
});
