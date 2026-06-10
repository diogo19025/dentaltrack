import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMetrics } from "./use-metrics";

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

describe("useMetrics", () => {
  it("busca GET /metrics com o range pedido", async () => {
    const metrics = { range: "50d", funnel: { started: 90, engaged: 53, scheduled: 21 } };
    apiFetch.mockResolvedValue(metrics);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useMetrics("50d"), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/metrics?range=50d");
    expect(result.current.data).toEqual(metrics);
  });

  it("cada range tem seu próprio cache (queryKey)", async () => {
    apiFetch.mockResolvedValue({});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = createWrapper(qc);

    const seven = renderHook(() => useMetrics("7d"), { wrapper });
    await waitFor(() => expect(seven.result.current.isSuccess).toBe(true));
    const ninety = renderHook(() => useMetrics("90d"), { wrapper });
    await waitFor(() => expect(ninety.result.current.isSuccess).toBe(true));

    expect(apiFetch).toHaveBeenNthCalledWith(1, "/metrics?range=7d");
    expect(apiFetch).toHaveBeenNthCalledWith(2, "/metrics?range=90d");
  });
});
