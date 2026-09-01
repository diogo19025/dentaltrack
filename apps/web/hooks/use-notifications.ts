"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  NotificationsDto,
  NotificationsSeenResult,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

/**
 * Sino do topbar (GET /notifications). Polling de 30s — mais lento que o board
 * do funil (15s) de propósito: notificação atrasar meio minuto não muda nada,
 * e o sino está montado em TODAS as telas.
 */
export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<NotificationsDto>("/notifications"),
    refetchInterval: 30_000,
  });
}

/**
 * Marca tudo como visto (POST /notifications/seen) ao abrir o painel. Otimista:
 * zera o badge na hora. De propósito NÃO invalida a query no fim — os pontos de
 * "não lida" ficam visíveis enquanto o painel está aberto (sumir na frente do
 * usuário parece bug); o polling de 30s traz o estado do servidor depois.
 */
export function useMarkNotificationsSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<NotificationsSeenResult>("/notifications/seen", {
        method: "POST",
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      queryClient.setQueryData<NotificationsDto>(["notifications"], (old) =>
        old ? { ...old, unreadCount: 0 } : old,
      );
    },
  });
}
