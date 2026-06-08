"use client";

import { useQuery } from "@tanstack/react-query";
import type { ConversationDetail, ConversationSummary } from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

/** Conversas recentes para a tabela do dashboard (GET /conversations?limit=). */
export function useRecentConversations(limit = 6) {
  return useQuery({
    queryKey: ["conversations", "recent", limit],
    queryFn: () => apiFetch<ConversationSummary[]>(`/conversations?limit=${limit}`),
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
