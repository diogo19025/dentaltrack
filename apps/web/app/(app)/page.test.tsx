import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./page";

const state = vi.hoisted(() => ({
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/use-metrics", () => ({
  useMetrics: () => ({
    data: undefined,
    isLoading: state.error === null,
    isError: state.error !== null,
    error: state.error,
    refetch: state.refetch,
  }),
}));

vi.mock("@/hooks/use-conversations", () => ({
  useRecentConversations: () => ({ data: [] }),
}));

vi.mock("@/hooks/use-leads", () => ({
  useLeads: () => ({ data: { leads: [] }, isLoading: false }),
}));

afterEach(() => {
  vi.clearAllMocks();
  state.error = null;
});

describe("DashboardPage", () => {
  it("mostra a falha das métricas em vez de um skeleton eterno", () => {
    state.error = new Error("Métricas indisponíveis");
    render(<DashboardPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Métricas indisponíveis",
    );
    fireEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });
});
