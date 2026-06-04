import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
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

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar userEmail={user.email ?? "Conta"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
