import { redirect } from "next/navigation";
import { AppMain } from "@/components/shell/app-main";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { WhatsappOnboarding } from "@/components/whatsapp/whatsapp-onboarding";
import { createClient } from "@/lib/supabase/server";

/**
 * Shell autenticado (F0.6/F0.7). Gate real de acesso: valida o usuário no
 * servidor e redireciona para /login se não houver sessão.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
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
  if (session?.access_token) {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    try {
      await fetch(`${apiUrl}/onboarding/bootstrap`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
    } catch {
      // API offline: segue renderizando (o chat tratará a falha).
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar userEmail={user.email ?? "Conta"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <AppMain>{children}</AppMain>
      </div>
      {/* Primeiro acesso: pergunta se a empresa já tem um número dedicado e,
          se tiver, faz o pareamento por QR ali mesmo (F10). Some sozinho depois
          de respondida — a conexão segue disponível em Configurações. */}
      <WhatsappOnboarding />
    </div>
  );
}
