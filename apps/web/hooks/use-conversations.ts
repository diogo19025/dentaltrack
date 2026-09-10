"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConversationDetail,
  ConversationSummary,
  HandoffState,
  StartHandoffInput,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

/** Conversas recentes para a tabela do dashboard (GET /conversations?limit=). */
export function useRecentConversations(limit = 6) {
  return useQuery({
    queryKey: ["conversations", "recent", limit],
    queryFn: () =>
      apiFetch<ConversationSummary[]>(`/conversations?limit=${limit}`),
  });
}

/**
 * Detalhe de uma conversa — tags detectadas ao vivo para o rail do chat
 * (GET /conversations/:id). Desabilitado enquanto não há `id`.
 */
export function useConversationDetail(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ["conversations", "detail", id],
    queryFn: () => apiFetch<ConversationDetail>(`/conversations/${id}`),
    enabled: Boolean(id) && enabled,
  });
}

/** Assume a conversa e pausa as respostas da IA. */
export function useAssumeConversation(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StartHandoffInput = {}) =>
      apiFetch<HandoffState>(`/conversations/${conversationId}/handoff`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });
}

/** Devolve a conversa ao agente de IA. */
export function useReleaseConversation(conversationId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<HandoffState>(`/conversations/${conversationId}/handoff`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });
}
