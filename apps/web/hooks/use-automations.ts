"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AutomationSettings,
  CreateHolidayInput,
  Holiday,
  OutboundMessageSummary,
  UpdateAutomationSettingsInput,
  UpdateOutboundMessageInput,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const AUTOMATIONS_KEY = ["automations"] as const;
const HISTORY_KEY = ["automations", "history"] as const;
const HOLIDAYS_KEY = ["holidays"] as const;

/** Configuração das automações da empresa (GET /automations). */
export function useAutomations() {
  return useQuery({
    queryKey: AUTOMATIONS_KEY,
    queryFn: () => apiFetch<AutomationSettings>("/automations"),
  });
}

/** Persiste a configuração (PATCH /automations) e atualiza o cache. */
export function useUpdateAutomations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAutomationSettingsInput) =>
      apiFetch<AutomationSettings>("/automations", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => queryClient.setQueryData(AUTOMATIONS_KEY, data),
  });
}

/**
 * Histórico dos disparos (GET /automations/history). Inclui o que foi
 * suprimido e o motivo — é o que responde "o lembrete saiu?" sem adivinhação.
 */
export function useAutomationHistory(limit = 50, enabled = true) {
  return useQuery({
    queryKey: [...HISTORY_KEY, limit],
    queryFn: () =>
      apiFetch<OutboundMessageSummary[]>(`/automations/history?limit=${limit}`),
    refetchInterval: 30_000,
    enabled,
  });
}

/** Edita/adia uma mensagem programada (PATCH /automations/messages/:id). */
export function useUpdateOutboundMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: UpdateOutboundMessageInput & { id: string }) =>
      apiFetch<OutboundMessageSummary>(`/automations/messages/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HISTORY_KEY }),
  });
}

/** Cancela uma mensagem programada (POST /automations/messages/:id/cancel). */
export function useCancelOutboundMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<OutboundMessageSummary>(`/automations/messages/${id}/cancel`, {
        method: "POST",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HISTORY_KEY }),
  });
}

export function useHolidays(year?: number) {
  return useQuery({
    queryKey: [...HOLIDAYS_KEY, year ?? "atual"],
    queryFn: () =>
      apiFetch<Holiday[]>(`/holidays${year ? `?year=${year}` : ""}`),
  });
}

export function useCreateHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHolidayInput) =>
      apiFetch<Holiday>("/holidays", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HOLIDAYS_KEY }),
  });
}

export function useDeleteHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/holidays/${id}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HOLIDAYS_KEY }),
  });
}

/** Importa os feriados nacionais do ano (os locais seguem manuais). */
export function useSyncHolidays() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (year?: number) =>
      apiFetch<{ imported: number }>(
        `/holidays/sync${year ? `?year=${year}` : ""}`,
        { method: "POST" },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HOLIDAYS_KEY }),
  });
}
