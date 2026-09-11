import { redirect } from "next/navigation";
import { AppMain } from "@/components/shell/app-main";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { WhatsappOnboarding } from "@/components/whatsapp/whatsapp-onboarding";
import { sessionIdFromToken } from "@/lib/session-id";
import { createClient } from "@/lib/supabase/server";
import {
  isRole,
  type OnboardingBootstrap,
  type Role,
} from "@dentaltrack/shared";
import { OwnerOnly, RoleProvider } from "@/components/auth/role-context";

/**
 * Shell autenticado (F0.6/F0.7). Gate real de acesso: valida o usuário no
 * servidor e redireciona para /login se não houver sessão.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Onboarding idempotente: garante empresa + membership do usuário no 1º acesso
  // (cobre signup, login e Google OAuth). Aguarda antes de renderizar para não
  // haver corrida com o /chat. Não bloqueia o app se a API estiver fora.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  let role: Role = "staff";
  if (session?.access_token) {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    try {
      const response = await fetch(`${apiUrl}/onboarding/bootstrap`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        console.error("[web.bootstrap.error]", { status: response.status });
      } else {
        const bootstrap = (await response.json()) as OnboardingBootstrap;
        if (isRole(bootstrap.role)) role = bootstrap.role;
      }
    } catch (error) {
      // API offline: segue renderizando, mas a falha não fica invisível.
      console.error("[web.bootstrap.error]", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return (
    <RoleProvider role={role}>
      <div className="flex h-full overflow-hidden">
        {/* sessionId identifica o login: o cartão "Assistente ativo" da sidebar
          aparece uma vez por login e, fechado, só volta no próximo. */}
        <Sidebar
          userEmail={user.email ?? "Conta"}
          sessionId={sessionIdFromToken(session?.access_token)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <AppMain>{children}</AppMain>
        </div>
        {/* Primeiro acesso: pergunta se a empresa já tem um número dedicado e,
          se tiver, faz o pareamento por QR ali mesmo (F10). Some sozinho depois
          de respondida — a conexão segue disponível em Configurações. */}
        <OwnerOnly>
          <WhatsappOnboarding />
        </OwnerOnly>
      </div>
    </RoleProvider>
  );
}
