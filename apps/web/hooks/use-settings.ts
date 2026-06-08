"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClinicSettingsDto, UpdateSettingsInput } from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const SETTINGS_KEY = ["settings"] as const;

/** Carrega as configurações do bot da clínica do usuário (GET /settings). */
export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiFetch<ClinicSettingsDto>("/settings"),
  });
}

/** Persiste as configurações (PATCH /settings) e atualiza o cache. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) =>
      apiFetch<ClinicSettingsDto>("/settings", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => queryClient.setQueryData(SETTINGS_KEY, data),
  });
}
