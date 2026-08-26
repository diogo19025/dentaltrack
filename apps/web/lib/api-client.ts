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
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, body || res.statusText);
  }
  return (await res.json()) as T;
}

/** Header Authorization com o JWT do Supabase (quando logado). */
async function authHeaders(): Promise<Headers> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers();
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  return headers;
}

/**
 * Baixa um arquivo da API (F8 · GET /leads/export) e dispara o download no
 * navegador, respeitando o filename do Content-Disposition.
 */
export async function apiDownload(path: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { headers: await authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, body || res.statusText);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? "download";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Upload multipart para a API (F8 · POST /leads/import). Sem Content-Type
 * manual — o navegador define o boundary do FormData.
 */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: await authHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, body || res.statusText);
  }
  return (await res.json()) as T;
}
