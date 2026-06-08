"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProcedureInput,
  ProcedureDto,
  UpdateProcedureInput,
} from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const PROCEDURES_KEY = ["procedures"] as const;

/** Lista o catálogo de procedimentos da clínica (GET /procedures). */
export function useProcedures() {
  return useQuery({
    queryKey: PROCEDURES_KEY,
    queryFn: () => apiFetch<ProcedureDto[]>("/procedures"),
  });
}

/** Cria um procedimento (POST /procedures). */
export function useCreateProcedure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProcedureInput) =>
      apiFetch<ProcedureDto>("/procedures", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROCEDURES_KEY }),
  });
}

/** Atualiza um procedimento (PATCH /procedures/:id). */
export function useUpdateProcedure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProcedureInput }) =>
      apiFetch<ProcedureDto>(`/procedures/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROCEDURES_KEY }),
  });
}

/** Remove um procedimento (DELETE /procedures/:id). */
export function useDeleteProcedure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(`/procedures/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROCEDURES_KEY }),
  });
}
