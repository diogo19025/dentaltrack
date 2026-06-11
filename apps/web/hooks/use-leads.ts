"use client";

import { useQuery } from "@tanstack/react-query";
import type { LeadDetail, LeadsResponse } from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

/** Leads capturados + resumo (GET /leads). */
export function useLeads() {
  return useQuery({ queryKey: ["leads"], queryFn: () => apiFetch<LeadsResponse>("/leads") });
}

/** Detalhe expandido de um lead (GET /leads/:id) — só busca com id presente. */
export function useLeadDetail(id: string | null) {
  return useQuery({
    queryKey: ["leads", "detail", id],
    queryFn: () => apiFetch<LeadDetail>(`/leads/${id}`),
    enabled: Boolean(id),
  });
}
