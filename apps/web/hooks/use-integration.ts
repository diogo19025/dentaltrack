"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConnectionCheck,
  IntegrationStatus,
  UpdateIntegrationInput,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const INTEGRATION_KEY = ["integrations", "clinicorp"] as const;

/**
 * Estado da integração com o sistema de gestão (GET /integrations/clinicorp).
 * A resposta **nunca** traz credencial — só a dica do usuário e o que já foi
 * escolhido no assistente de conexão.
 */
export function useIntegration() {
  return useQuery({
    queryKey: INTEGRATION_KEY,
    queryFn: () => apiFetch<IntegrationStatus>("/integrations/clinicorp"),
  });
}

export function useUpdateIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateIntegrationInput) =>
      apiFetch<IntegrationStatus>("/integrations/clinicorp", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => queryClient.setQueryData(INTEGRATION_KEY, data),
  });
}

/**
 * Verificação de conexão (POST /integrations/clinicorp/check) — a cadeia
 * só-leitura, passo a passo. É o que mostra a verdade sobre a API no dia em que
 * a credencial chega, em vez de descobri-la depurando em produção.
 */
export function useCheckIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<ConnectionCheck>("/integrations/clinicorp/check", {
        method: "POST",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: INTEGRATION_KEY }),
  });
}
