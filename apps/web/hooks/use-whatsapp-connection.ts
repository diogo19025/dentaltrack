"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WhatsappConnection,
  WhatsappOnboardingAnswer,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const CONNECTION_KEY = ["whatsapp", "connection"] as const;

/**
 * Estado da conexão do WhatsApp da empresa (GET /whatsapp/connection).
 *
 * Enquanto houver pareamento pendente, consulta de 3 em 3 segundos: é assim que
 * a tela percebe que o celular leu o QR e troca sozinha para "conectado", sem
 * o dono precisar recarregar nada.
 */
export function useWhatsappConnection(enabled = true) {
  return useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: () => apiFetch<WhatsappConnection>("/whatsapp/connection"),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.state === "aguardando_leitura" ? 3_000 : false,
  });
}

/**
 * Pede um QR novo (POST /whatsapp/connection). Chamar de novo é o caminho
 * normal de "o QR expirou" — a Evolution devolve um código novo a cada chamada.
 */
export function useConnectWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<WhatsappConnection>("/whatsapp/connection", { method: "POST" }),
    onSuccess: (data) => queryClient.setQueryData(CONNECTION_KEY, data),
  });
}

/** Resposta à pergunta do primeiro acesso ("já tem um número dedicado?"). */
export function useAnswerWhatsappOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answer: WhatsappOnboardingAnswer) =>
      apiFetch<WhatsappConnection>("/whatsapp/connection/onboarding", {
        method: "POST",
        body: JSON.stringify({ answer }),
      }),
    onSuccess: (data) => queryClient.setQueryData(CONNECTION_KEY, data),
  });
}

/** Desconecta o número, mantendo a instância para reparear depois. */
export function useDisconnectWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<WhatsappConnection>("/whatsapp/connection/disconnect", {
        method: "POST",
      }),
    onSuccess: (data) => queryClient.setQueryData(CONNECTION_KEY, data),
  });
}

/** Remove a instância e desfaz o vínculo (troca de número). */
export function useResetWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<WhatsappConnection>("/whatsapp/connection", {
        method: "DELETE",
      }),
    onSuccess: (data) => queryClient.setQueryData(CONNECTION_KEY, data),
  });
}
