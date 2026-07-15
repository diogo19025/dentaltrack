import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PipelineResponse } from "@dentaltrack/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useCreatePipelineStage,
  useMovePipelineCard,
  usePipeline,
} from "./use-pipeline";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiFetch }));

const CARD = "11111111-1111-1111-1111-111111111111";
const STAGE_A = "33333333-3333-3333-3333-333333333333";
const STAGE_B = "44444444-4444-4444-4444-444444444444";

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function board(): PipelineResponse {
  return {
    stages: [
      { id: STAGE_A, name: "Quero agendar", position: 2, systemStage: "quero_agendar" },
      { id: STAGE_B, name: "Agendado", position: 4, systemStage: "agendado" },
    ],
    cards: [
      {
        id: CARD,
        stageId: STAGE_A,
        source: "auto",
        stageSource: "auto",
        name: "João Silva",
        phone: null,
        channel: "web",
        conversationId: "22222222-2222-2222-2222-222222222222",
        leadId: null,
        status: "em_andamento",
        note: null,
        lastMessageAt: "2026-07-14T12:00:00.000Z",
        stageUpdatedAt: "2026-07-14T12:00:00.000Z",
        createdAt: "2026-07-14T11:00:00.000Z",
      },
    ],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePipeline", () => {
  it("busca o board (colunas + cards) em GET /pipeline", async () => {
    apiFetch.mockResolvedValue(board());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => usePipeline(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/pipeline");
    expect(result.current.data?.stages).toHaveLength(2);
    expect(result.current.data?.cards[0].stageId).toBe(STAGE_A);
  });
});

describe("useMovePipelineCard", () => {
  it("move o card de forma otimista e chama o PATCH", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["pipeline"], board());
    let resolvePatch: (v: unknown) => void = () => {};
    apiFetch.mockImplementation(() => new Promise((r) => (resolvePatch = r)));

    const { result } = renderHook(() => useMovePipelineCard(), {
      wrapper: createWrapper(qc),
    });
    result.current.mutate({ id: CARD, stageId: STAGE_B });

    // Antes do PATCH resolver, o cache já reflete o movimento (otimista).
    await waitFor(() => {
      const data = qc.getQueryData<PipelineResponse>(["pipeline"]);
      expect(data?.cards[0]).toMatchObject({ stageId: STAGE_B, stageSource: "manual" });
    });
    expect(apiFetch).toHaveBeenCalledWith(`/pipeline/cards/${CARD}`, {
      method: "PATCH",
      body: JSON.stringify({ stageId: STAGE_B }),
    });
    resolvePatch({});
  });

  it("faz rollback do cache se o PATCH falhar", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    qc.setQueryData(["pipeline"], board());
    apiFetch.mockRejectedValue(new Error("500"));

    const { result } = renderHook(() => useMovePipelineCard(), {
      wrapper: createWrapper(qc),
    });
    result.current.mutate({ id: CARD, stageId: STAGE_B });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const data = qc.getQueryData<PipelineResponse>(["pipeline"]);
    expect(data?.cards[0].stageId).toBe(STAGE_A);
  });
});

describe("useCreatePipelineStage", () => {
  it("cria a coluna em POST /pipeline/stages e invalida o board", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    apiFetch.mockResolvedValue({ id: STAGE_B, name: "Pós-venda", position: 5, systemStage: null });

    const { result } = renderHook(() => useCreatePipelineStage(), {
      wrapper: createWrapper(qc),
    });
    result.current.mutate({ name: "Pós-venda" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith("/pipeline/stages", {
      method: "POST",
      body: JSON.stringify({ name: "Pós-venda" }),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pipeline"] });
  });
});
