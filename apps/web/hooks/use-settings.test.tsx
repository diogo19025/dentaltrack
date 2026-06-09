import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSettings, useUpdateSettings } from "./use-settings";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiFetch }));

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSettings", () => {
  it("busca GET /settings e expõe os dados", async () => {
    const settings = { clinicName: "Clínica Demo", tone: "amigavel" };
    apiFetch.mockResolvedValue(settings);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useSettings(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/settings");
    expect(result.current.data).toEqual(settings);
  });
});

describe("useUpdateSettings", () => {
  it("faz PATCH /settings e atualiza o cache no sucesso", async () => {
    const saved = { clinicName: "Clínica Nova", tone: "formal" };
    apiFetch.mockResolvedValue(saved);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useUpdateSettings(), { wrapper: createWrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({ clinicName: "Clínica Nova" });
    });

    expect(apiFetch).toHaveBeenCalledWith("/settings", {
      method: "PATCH",
      body: JSON.stringify({ clinicName: "Clínica Nova" }),
    });
    expect(qc.getQueryData(["settings"])).toEqual(saved);
  });
});
