"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { MetricsDto, MetricsRange } from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

/**
 * Métricas do dashboard para a janela `range` (GET /metrics?range=).
 *
 * Ao trocar o período o dado anterior fica na tela até o novo chegar
 * (`isPlaceholderData` diz que está desatualizado). Sem isso a tela voltava ao
 * skeleton e todos os cards reentravam com a animação de primeira pintura a
 * cada clique no seletor.
 */
export function useMetrics(range: MetricsRange) {
  return useQuery({
    queryKey: ["metrics", range],
    queryFn: () => apiFetch<MetricsDto>(`/metrics?range=${range}`),
    placeholderData: keepPreviousData,
  });
}
