import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { OnboardingChecklistDto } from "@dentaltrack/shared";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ONBOARDING_CHECKLIST_KEY,
  useOnboardingChecklist,
} from "./use-onboarding-checklist";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiFetch }));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const checklist = (done: number): OnboardingChecklistDto => ({
  items: [],
  done,
  total: 6,
  complete: done === 6,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOnboardingChecklist", () => {
  it("reconsulta ao montar mesmo quando o cache global ainda está fresco", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    queryClient.setQueryData(ONBOARDING_CHECKLIST_KEY, checklist(1));
    apiFetch.mockResolvedValue(checklist(2));

    const { result } = renderHook(() => useOnboardingChecklist(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data?.done).toBe(2));
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(apiFetch).toHaveBeenCalledWith("/onboarding/checklist");
  });
});
