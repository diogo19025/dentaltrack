"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MetaConnection,
  SaveMetaCredentialsInput,
  WhatsappProvider,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const META_KEY = ["whatsapp", "meta"] as const;

/** Credenciais da Cloud API da Meta da empresa (sem nenhum segredo). */
export function useMetaConnection() {
  return useQuery({
    queryKey: META_KEY,
    queryFn: () => apiFetch<MetaConnection>("/whatsapp/meta/connection"),
  });
}

/** Valida na Meta e guarda cifrado. O provedor ativo não muda. */
export function useSaveMetaCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveMetaCredentialsInput) =>
      apiFetch<MetaConnection>("/whatsapp/meta/connection", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => queryClient.setQueryData(META_KEY, data),
  });
}

/** Escolhe qual provedor atende: QR code (Evolution) ou Meta. */
export function useSetWhatsappProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: WhatsappProvider) =>
      apiFetch<MetaConnection>("/whatsapp/provider", {
        method: "PUT",
        body: JSON.stringify({ provider }),
      }),
    onSuccess: (data) => queryClient.setQueryData(META_KEY, data),
  });
}

/** Apaga as credenciais; se a Meta era a ativa, volta ao QR code. */
export function useRemoveMetaCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<MetaConnection>("/whatsapp/meta/connection", {
        method: "DELETE",
      }),
    onSuccess: (data) => queryClient.setQueryData(META_KEY, data),
  });
}
