import { ApiError } from "@/lib/api-client";

/**
 * Ponto único de observabilidade do cliente. O plano mantém a instrumentação
 * do Sentry no backend; no browser registramos só metadados não sensíveis e o
 * requestId que liga a falha à captura feita pela API.
 */
export function reportClientError(
  error: unknown,
  context: Record<string, unknown>,
): void {
  const apiError = error instanceof ApiError ? error : null;
  console.error("[web.error]", {
    ...context,
    name: error instanceof Error ? error.name : "UnknownError",
    status: apiError?.status,
    requestId: apiError?.requestId,
  });
}
