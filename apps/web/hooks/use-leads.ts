"use client";

import { useQuery } from "@tanstack/react-query";
import type { LeadsResponse } from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

/** Leads capturados + resumo (GET /leads). */
export function useLeads() {
  return useQuery({ queryKey: ["leads"], queryFn: () => apiFetch<LeadsResponse>("/leads") });
}
