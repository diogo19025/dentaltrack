"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePipelineCardInput,
  CreatePipelineStageInput,
  PipelineCardDto,
  PipelineResponse,
  PipelineStageDto,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

/**
 * Funil de atendimento (F7). O board é atualizado também pelo detector
 * automático no backend a cada turno de conversa, então a query faz polling
 * curto para os cards "andarem sozinhos" na tela enquanto o dono a observa.
 */

const QUERY_KEY = ["pipeline"] as const;
const POLL_MS = 15_000;

/** Board completo (GET /pipeline), com polling para refletir o detector. */
export function usePipeline() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<PipelineResponse>("/pipeline"),
    refetchInterval: POLL_MS,
  });
}

/**
 * Movimento manual (PATCH /pipeline/cards/:id) com update otimista: o card
 * troca de coluna na hora; rollback se a API falhar.
 */
export function useMovePipelineCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      apiFetch<PipelineCardDto>(`/pipeline/cards/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ stageId }),
      }),
    onMutate: async ({ id, stageId }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<PipelineResponse>(QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<PipelineResponse>(QUERY_KEY, {
          ...previous,
          cards: previous.cards.map((c) =>
            c.id === id ? { ...c, stageId, stageSource: "manual" as const } : c,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/** Cliente adicionado à mão (POST /pipeline/cards) — também cria um Lead. */
export function useCreatePipelineCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePipelineCardInput) =>
      apiFetch<PipelineCardDto>("/pipeline/cards", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      // O card manual cria um Lead (source=manual) → a lista de leads mudou.
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/** Remove um card do board (DELETE /pipeline/cards/:id). */
export function useDeletePipelineCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(`/pipeline/cards/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/** Nova coluna personalizada (POST /pipeline/stages) — entra no fim do board. */
export function useCreatePipelineStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePipelineStageInput) =>
      apiFetch<PipelineStageDto>("/pipeline/stages", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/** Renomeia uma coluna (PATCH /pipeline/stages/:id) — vale p/ as do sistema. */
export function useRenamePipelineStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<PipelineStageDto>(`/pipeline/stages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/**
 * Exclui uma coluna personalizada (DELETE /pipeline/stages/:id); os cards dela
 * voltam para a primeira coluna do board (regra do backend).
 */
export function useDeletePipelineStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(`/pipeline/stages/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
