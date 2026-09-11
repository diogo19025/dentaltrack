"use client";

import { useQuery } from "@tanstack/react-query";
import type { OnboardingChecklistDto } from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

export const ONBOARDING_CHECKLIST_KEY = ["onboarding", "checklist"] as const;

/**
 * Checklist de onboarding (GET /onboarding/checklist). Derivado do estado
 * real das tabelas, então basta reconsultar ao voltar para o dashboard —
 * `refetchOnWindowFocus` cobre quem foi configurar noutra aba do navegador.
 */
export function useOnboardingChecklist() {
  return useQuery({
    queryKey: ONBOARDING_CHECKLIST_KEY,
    queryFn: () => apiFetch<OnboardingChecklistDto>("/onboarding/checklist"),
    refetchOnWindowFocus: true,
  });
}
