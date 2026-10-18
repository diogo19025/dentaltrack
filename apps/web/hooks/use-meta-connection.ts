"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MetaConnection,
  SaveMetaCredentialsInput,
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

/** Valida na Meta, guarda cifrado e passa a empresa para o provedor oficial. */
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

/** Apaga as credenciais e volta ao provedor anterior (Evolution). */
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
