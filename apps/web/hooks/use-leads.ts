"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LeadDetail,
  LeadImportResult,
  LeadPrivacy,
  LeadsResponse,
} from "@dentaltrack/shared";
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

/**
 * Invalida o lead aberto e a lista (P1.5). As duas operacoes de privacidade
 * mudam o que a tabela mostra — um lead anonimizado perde nome e telefone.
 */
function useInvalidateLead(id: string | null) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["leads", "detail", id] });
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
  };
}

/**
 * Anonimiza os dados pessoais do lead (P1.5 · DELETE /leads/:id/dados-pessoais).
 * Irreversivel e owner-only no servidor.
 */
export function useAnonymizeLead(id: string | null) {
  const invalidate = useInvalidateLead(id);
  return useMutation({
    mutationFn: () =>
      apiFetch<LeadPrivacy>(`/leads/${id}/dados-pessoais`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}

/** Liga/desliga o descadastro das mensagens automaticas (P1.5). */
export function useSetLeadOptOut(id: string | null) {
  const invalidate = useInvalidateLead(id);
  return useMutation({
    mutationFn: (optedOut: boolean) =>
      apiFetch<LeadPrivacy>(`/leads/${id}/opt-out`, {
        method: "PUT",
        body: JSON.stringify({ optedOut }),
      }),
    onSuccess: invalidate,
  });
}
