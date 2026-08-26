"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LeadDetail, LeadImportResult, LeadsResponse } from "@dentaltrack/shared";
import { apiFetch, apiUpload } from "@/lib/api-client";

/** Leads capturados + resumo (GET /leads). */
export function useLeads() {
  return useQuery({ queryKey: ["leads"], queryFn: () => apiFetch<LeadsResponse>("/leads") });
}

/** Importa uma planilha de leads (F8 · POST /leads/import) e atualiza a lista. */
export function useImportLeads() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return apiUpload<LeadImportResult>("/leads/import", formData);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/** Detalhe expandido de um lead (GET /leads/:id) — só busca com id presente. */
export function useLeadDetail(id: string | null) {
  return useQuery({
    queryKey: ["leads", "detail", id],
    queryFn: () => apiFetch<LeadDetail>(`/leads/${id}`),
    enabled: Boolean(id),
  });
}
