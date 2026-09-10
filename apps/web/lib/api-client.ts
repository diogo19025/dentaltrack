import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Cabeçalho de correlação — o mesmo id aparece no log da API (P0.3). */
const REQUEST_ID_HEADER = "x-request-id";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /**
     * Código da operação que falhou. É o que a tela mostra ao usuário e o que o
     * suporte usa para achar as linhas de log daquela chamada no servidor —
     * sem ele, "deu erro" não tem como ser investigado.
     */
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Gera o id de correlação da chamada. Gerar no cliente (em vez de só ler o que
 * a API devolve) faz o código existir mesmo quando a requisição nem chega ao
 * servidor — que é justamente o caso mais confuso de diagnosticar.
 */
function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `web-${Date.now().toString(36)}`;
}

/** Erro HTTP com o id de correlação preservado. */
async function errorFrom(res: Response, requestId: string): Promise<ApiError> {
  const body = await res.text().catch(() => res.statusText);
  return new ApiError(res.status, body || res.statusText, requestId);
}

/**
 * A frase que se mostra ao usuário a partir de um erro qualquer.
 *
 * O corpo de erro do Nest é JSON (`{ statusCode, message, requestId }`), e o
 * `ApiError` guarda esse texto cru: exibi-lo direto põe chaves e aspas na tela.
 * Aqui ele volta a ser uma frase — e `message` também pode ser **lista**
 * (o ValidationPipe devolve um erro por campo), caso em que as linhas são
 * juntadas em vez de virarem "[object Object]".
 */
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return "Não foi possível concluir a operação.";
  const raw = err.message?.trim();
  if (!raw) return "Não foi possível concluir a operação.";
  if (!raw.startsWith("{")) return raw;
  try {
    const body = JSON.parse(raw) as { message?: unknown };
    const message = body.message;
    if (Array.isArray(message)) return message.join(" · ");
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // Corpo que não é JSON: o texto cru já é a melhor informação disponível.
  }
  return raw;
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
  const requestId = newRequestId();
  headers.set(REQUEST_ID_HEADER, requestId);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (!res.ok) throw await errorFrom(res, requestId);
  return (await res.json()) as T;
}

/** Header Authorization com o JWT do Supabase (quando logado), mais correlação. */
async function authHeaders(requestId: string): Promise<Headers> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers();
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  headers.set(REQUEST_ID_HEADER, requestId);
  return headers;
}

/**
 * Baixa um arquivo da API (F8 · GET /leads/export) e dispara o download no
 * navegador, respeitando o filename do Content-Disposition.
 */
export async function apiDownload(path: string): Promise<void> {
  const requestId = newRequestId();
  const res = await fetch(`${API_URL}${path}`, { headers: await authHeaders(requestId) });
  if (!res.ok) throw await errorFrom(res, requestId);
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
  const requestId = newRequestId();
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: await authHeaders(requestId),
    body: formData,
  });
  if (!res.ok) throw await errorFrom(res, requestId);
  return (await res.json()) as T;
}
