import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fetch tipado para a API NestJS. Anexa o JWT do Supabase (Bearer) em toda
 * chamada. Usado pelo TanStack Query nos componentes de cliente.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(init?.headers);
  // FormData (upload de áudio) define o próprio Content-Type (boundary do multipart).
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!headers.has("Content-Type") && !isFormData) headers.set("Content-Type", "application/json");
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, body || res.statusText);
  }
  return (await res.json()) as T;
}
