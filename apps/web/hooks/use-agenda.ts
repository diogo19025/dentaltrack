"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgendaResponse, Availability } from "@dentaltrack/shared";
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
    queryFn: () => apiFetch<AgendaResponse>(`/agenda${query ? `?${query}` : ""}`),
    // A sincronização com o sistema de gestão roda a cada 10 minutos; recarregar
    // no mesmo ritmo mantém a tela coerente sem martelar a API.
    refetchInterval: 60_000,
  });
}

/**
 * Horários livres (GET /agenda/disponibilidade) — o mesmo dado que o agente
 * usa. Mostrar isto na tela é o que permite ao dono conferir o que o bot está
 * oferecendo aos clientes dele.
 */
export function useAvailability(days = 10) {
  return useQuery({
    queryKey: [...AGENDA_KEY, "disponibilidade", days],
    queryFn: () =>
      apiFetch<Availability>(`/agenda/disponibilidade?dias=${days}`),
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
