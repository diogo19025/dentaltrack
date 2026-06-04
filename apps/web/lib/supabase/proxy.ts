import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Atualiza/renova a sessão Supabase a cada request (chamado pelo proxy.ts).
 * Mantém os cookies de auth frescos. A verificação real de acesso fica nas
 * rotas/layout protegidos (ver app/(app)/layout.tsx).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANTE: não rode código entre createServerClient e getUser() —
  // pode causar logout aleatório (recomendação oficial do Supabase).
  await supabase.auth.getUser();

  return response;
}
