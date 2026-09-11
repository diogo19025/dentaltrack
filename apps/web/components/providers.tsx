"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api-client";
import { reportClientError } from "@/lib/client-errors";

/** Erro do cliente não melhora com retry; indisponibilidade e rede podem melhorar. */
export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) =>
            reportClientError(error, {
              source: "query",
              queryKey: query.queryHash,
            }),
        }),
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) =>
            reportClientError(error, {
              source: "mutation",
              mutationId: mutation.mutationId,
            }),
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: shouldRetryRequest,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
