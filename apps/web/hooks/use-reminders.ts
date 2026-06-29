"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReminderContext, SendReminderResult } from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

/**
 * Contexto da caixa "Enviar lembrete" (GET /conversations/:id/reminder): o
 * rascunho determinístico pré-preenchido + a elegibilidade (tem telefone? a
 * clínica conectou o WhatsApp?). Só busca quando há `conversationId` — os painéis
 * montam o componente só ao abrir, então a rede só acontece sob demanda.
 */
export function useReminderContext(conversationId: string | null) {
  return useQuery({
    queryKey: ["reminder", "context", conversationId],
    queryFn: () =>
      apiFetch<ReminderContext>(`/conversations/${conversationId}/reminder`),
    enabled: Boolean(conversationId),
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Envia o lembrete por WhatsApp (POST /conversations/:id/reminder) e invalida o
 * que ele muda: a conversa ganhou uma mensagem (e pode ter reaberto) e o lead /
 * as "conversas recentes" refletem isso.
 */
export function useSendReminder(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) =>
      apiFetch<SendReminderResult>(
        `/conversations/${conversationId}/reminder`,
        { method: "POST", body: JSON.stringify({ message }) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
