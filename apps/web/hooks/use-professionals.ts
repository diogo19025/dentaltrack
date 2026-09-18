"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProfessionalInput,
  ProfessionalDto,
  ProfessionalsResponse,
  UpdateProfessionalInput,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const PROFESSIONALS_KEY = ["professionals"] as const;

/**
 * Profissionais da empresa (GET /professionals — F20).
 *
 * Vem do cadastro espelhado, e não do resultado da verificação de conexão: a
 * equipe precisa continuar na tela depois de recarregar a página, e a agenda
 * precisa dela mesmo quando ninguém acabou de verificar a conexão.
 */
export function useProfessionals(includeInactive = false) {
  return useQuery({
    queryKey: [...PROFESSIONALS_KEY, includeInactive] as const,
    queryFn: async () => {
      const data = await apiFetch<ProfessionalsResponse>(
        `/professionals${includeInactive ? "?incluirInativos=true" : ""}`,
      );
      return data.professionals;
    },
  });
}

export function useCreateProfessional() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProfessionalInput) =>
      apiFetch<ProfessionalDto>("/professionals", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PROFESSIONALS_KEY }),
  });
}

export function useUpdateProfessional() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: UpdateProfessionalInput & { id: string }) =>
      apiFetch<ProfessionalDto>(`/professionals/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PROFESSIONALS_KEY }),
  });
}
