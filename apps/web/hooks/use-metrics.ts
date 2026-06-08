"use client";

import { useQuery } from "@tanstack/react-query";
import type { MetricsDto, MetricsRange } from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

/** Métricas do dashboard para a janela `range` (GET /metrics?range=). */
export function useMetrics(range: MetricsRange) {
  return useQuery({
    queryKey: ["metrics", range],
    queryFn: () => apiFetch<MetricsDto>(`/metrics?range=${range}`),
  });
}
