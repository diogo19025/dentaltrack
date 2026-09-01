"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConnectionCheck,
  IntegrationProvider,
  IntegrationStatus,
  UpdateIntegrationInput,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const integrationKey = (provider: IntegrationProvider) =>
  ["integrations", provider] as const;

/**
 * Estado da integração de agenda (GET /integrations/:provider — Clinicorp ou
 * Google Agenda). A resposta **nunca** traz credencial — só a dica do usuário
 * e o que já foi escolhido no assistente de conexão.
 */
export function useIntegration(provider: IntegrationProvider, enabled = true) {
  return useQuery({
    queryKey: integrationKey(provider),
    queryFn: () => apiFetch<IntegrationStatus>(`/integrations/${provider}`),
    enabled,
  });
}

export function useUpdateIntegration(provider: IntegrationProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateIntegrationInput) =>
      apiFetch<IntegrationStatus>(`/integrations/${provider}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(integrationKey(provider), data);
      // Ligar um provedor desliga o outro no servidor; o estado do outro
      // precisa refletir isso na próxima olhada.
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
  });
}

/**
 * Verificação de conexão (POST /integrations/:provider/check) — a cadeia
 * só-leitura, passo a passo. É o que mostra a verdade sobre a API no dia em que
 * a credencial chega, em vez de descobri-la depurando em produção.
 */
export function useCheckIntegration(provider: IntegrationProvider) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<ConnectionCheck>(`/integrations/${provider}/check`, {
        method: "POST",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKey(provider) }),
  });
}
