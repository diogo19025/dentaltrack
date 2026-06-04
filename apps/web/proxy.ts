import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Proxy (Next.js 16 — antes chamado "middleware"). Renova a sessão Supabase.
 * A autorização real é feita nos layouts/rotas protegidos, não aqui.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Casa todas as rotas, exceto:
     * - _next/static, _next/image (assets internos)
     * - favicon.ico e arquivos de imagem
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
