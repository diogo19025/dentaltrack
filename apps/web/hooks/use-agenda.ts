"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgendaResponse, AppointmentSummary } from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const AGENDA_KEY = ["agenda"] as const;

/** Agendamentos numa janela de datas (GET /agenda). */
export function useAgenda(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();

  return useQuery({
    queryKey: [...AGENDA_KEY, from ?? "hoje", to ?? "7d"],
    queryFn: () =>
      apiFetch<AgendaResponse>(`/agenda${query ? `?${query}` : ""}`),
    // A sincronização com o sistema de gestão roda a cada 10 minutos; recarregar
    // no mesmo ritmo mantém a tela coerente sem martelar a API.
    refetchInterval: 60_000,
  });
}

/**
 * Sincroniza a agenda agora (POST /agenda/sync), sem esperar a varredura de 10
 * minutos — o que a tela precisa logo depois de conectar a integração.
 */
export function useSyncAgenda() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ criados: number; atualizados: number; ignorados: number }>(
        "/agenda/sync",
        { method: "POST" },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AGENDA_KEY }),
  });
}

/**
 * Cancela um agendamento (POST /agenda/:id/cancelar) — na agenda real da
 * empresa e aqui. Idempotente no servidor: repetir devolve o já cancelado.
 */
export function useCancelAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<AppointmentSummary>(`/agenda/${id}/cancelar`, {
        method: "POST",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AGENDA_KEY }),
  });
}

/** Move um agendamento para outro horário (POST /agenda/:id/remarcar). */
export function useRescheduleAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, startsAt }: { id: string; startsAt: string }) =>
      apiFetch<AppointmentSummary>(`/agenda/${id}/remarcar`, {
        method: "POST",
        body: JSON.stringify({ startsAt }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AGENDA_KEY }),
  });
}
