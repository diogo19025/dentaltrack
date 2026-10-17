"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WhatsappConnection,
  WhatsappLine,
  WhatsappOnboardingAnswer,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const connectionKey = (line: WhatsappLine) =>
  ["whatsapp", "connection", line] as const;
/** `?numero=` só para o de avisos; o principal mantém a URL de sempre. */
const path = (line: WhatsappLine, sub = "") =>
  `/whatsapp/connection${sub}${line === "avisos" ? "?numero=avisos" : ""}`;

/**
 * Estado da conexão do WhatsApp da empresa (GET /whatsapp/connection).
 *
 * Enquanto houver pareamento pendente, consulta de 3 em 3 segundos: é assim que
 * a tela percebe que o celular leu o QR e troca sozinha para "conectado", sem
 * o dono precisar recarregar nada.
 */
export function useWhatsappConnection(
  enabled = true,
  line: WhatsappLine = "principal",
) {
  return useQuery({
    queryKey: connectionKey(line),
    queryFn: () => apiFetch<WhatsappConnection>(path(line)),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.state === "aguardando_leitura" ? 3_000 : false,
  });
}

/**
 * Pede um QR novo (POST /whatsapp/connection). Chamar de novo é o caminho
 * normal de "o QR expirou" — a Evolution devolve um código novo a cada chamada.
 */
export function useConnectWhatsapp(line: WhatsappLine = "principal") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<WhatsappConnection>(path(line), { method: "POST" }),
    onSuccess: (data) => queryClient.setQueryData(connectionKey(line), data),
  });
}

/** Resposta à pergunta do primeiro acesso ("já tem um número dedicado?"). */
export function useAnswerWhatsappOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answer: WhatsappOnboardingAnswer) =>
      apiFetch<WhatsappConnection>(path("principal", "/onboarding"), {
        method: "POST",
        body: JSON.stringify({ answer }),
      }),
    onSuccess: (data) => queryClient.setQueryData(connectionKey("principal"), data),
  });
}

/** Desconecta o número, mantendo a instância para reparear depois. */
export function useDisconnectWhatsapp(line: WhatsappLine = "principal") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<WhatsappConnection>(path(line, "/disconnect"), {
        method: "POST",
      }),
    onSuccess: (data) => queryClient.setQueryData(connectionKey(line), data),
  });
}

/** Remove a instância e desfaz o vínculo (troca de número). */
export function useResetWhatsapp(line: WhatsappLine = "principal") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<WhatsappConnection>(path(line), {
        method: "DELETE",
      }),
    onSuccess: (data) => queryClient.setQueryData(connectionKey(line), data),
  });
}
