"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTagInput, TagDto, UpdateTagInput } from "@dentaltrack/shared";
import { apiFetch } from "@/lib/api-client";

const TAGS_KEY = ["tags"] as const;

/** Lista as tags da clínica (GET /tags). */
export function useTags() {
  return useQuery({ queryKey: TAGS_KEY, queryFn: () => apiFetch<TagDto[]>("/tags") });
}

/** Cria uma tag (POST /tags). */
export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTagInput) =>
      apiFetch<TagDto>("/tags", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TAGS_KEY }),
  });
}

/** Atualiza uma tag (PATCH /tags/:id). */
export function useUpdateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTagInput }) =>
      apiFetch<TagDto>(`/tags/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TAGS_KEY }),
  });
}

/** Remove uma tag (DELETE /tags/:id). */
export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ id: string }>(`/tags/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TAGS_KEY }),
  });
}
