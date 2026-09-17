import { redirect } from "next/navigation";
import { AppMain } from "@/components/shell/app-main";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { WhatsappOnboarding } from "@/components/whatsapp/whatsapp-onboarding";
import { sessionIdFromToken } from "@/lib/session-id";
import { createClient } from "@/lib/supabase/server";
import {
  type ClinicSettingsDto,
  isRole,
  type OnboardingBootstrap,
  type Role,
} from "@dentaltrack/shared";
import { OwnerOnly, RoleProvider } from "@/components/auth/role-context";
import { RoleNotice } from "@/components/auth/role-notice";

/** Quanto esperar o bootstrap antes de desistir de uma tentativa. */
const BOOTSTRAP_TIMEOUT_MS = 8_000;
/** Tentativas totais. A segunda existe para o cold start da API. */
const BOOTSTRAP_ATTEMPTS = 2;

/**
 * Resolve o papel do usuário no bootstrap. Devolve `null` quando não conseguiu
 * — nunca um papel chutado.
 *
 * Duas tentativas e um timeout explícito porque o modo de falha real não é "a
 * API está fora", é **"a API está acordando"**: o primeiro request depois de um
 * período ocioso pode levar dezenas de segundos, e sem `signal` o `fetch` não
 * desiste nunca, segurando o render do layout inteiro.
 */
async function fetchRole(accessToken: string): Promise<Role | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  for (let attempt = 1; attempt <= BOOTSTRAP_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/onboarding/bootstrap`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(BOOTSTRAP_TIMEOUT_MS),
      });
      if (response.ok) {
        const bootstrap = (await response.json()) as OnboardingBootstrap;
        // Uma API mais antiga responde sem o campo: `null`, não `staff`.
        return isRole(bootstrap.role) ? bootstrap.role : null;
      }
      // 4xx não melhora na segunda tentativa; 5xx e timeout podem.
      if (response.status < 500) {
        console.error("[web.bootstrap.error]", { status: response.status });
        return null;
      }
      console.error("[web.bootstrap.error]", {
        status: response.status,
        attempt,
      });
    } catch (error) {
      console.error("[web.bootstrap.error]", {
        name: error instanceof Error ? error.name : "UnknownError",
        attempt,
      });
    }
  }

  return null;
}

/** O que o shell precisa saber da empresa antes do primeiro paint. */
type ShellBrand = Pick<ClinicSettingsDto, "clinicName" | "logoUrl">;

/**
 * Marca da empresa para o primeiro render do shell — nome e logo.
 *
 * Sem isto a sidebar nasce com a marca da plataforma e as iniciais, e troca
 * para a empresa quando `GET /settings` responde no cliente: um piscar em
 * todo carregamento, no lugar mais visível da tela. Best-effort de propósito:
 * `null` aqui só significa que o cliente resolve como sempre resolveu.
 */
async function fetchBrand(accessToken: string): Promise<ShellBrand | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  try {
    const response = await fetch(`${apiUrl}/settings`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(BOOTSTRAP_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const settings = (await response.json()) as Partial<ClinicSettingsDto>;
    return {
      clinicName: settings.clinicName ?? "",
      logoUrl: settings.logoUrl ?? "",
    };
  } catch {
    return null;
  }
}

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

  // `null` = não foi possível determinar, e isso **não** é o mesmo que `staff`
  // (ver `components/auth/role-context.tsx`). Começar em `staff` era o que
  // rebaixava o dono a atendente sempre que a API demorava ou estava numa
  // versão que ainda não devolvia o papel.
  // A marca vai junto, em paralelo: o bootstrap é quem garante que a empresa
  // existe, mas o `GET /settings` é idempotente e, no 1º acesso, um 404 aqui só
  // deixa o cliente resolver a marca como antes.
  const [role, brandData]: [Role | null, ShellBrand | null] =
    session?.access_token
      ? await Promise.all([
          fetchRole(session.access_token),
          fetchBrand(session.access_token),
        ])
      : [null, null];

  return (
    <RoleProvider role={role}>
      <div className="flex h-full overflow-hidden">
        {/* sessionId identifica o login: o cartão "Assistente ativo" da sidebar
          aparece uma vez por login e, fechado, só volta no próximo. */}
        <Sidebar
          userEmail={user.email ?? "Conta"}
          clinicName={brandData?.clinicName}
          logoUrl={brandData?.logoUrl}
          sessionId={sessionIdFromToken(session?.access_token)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <RoleNotice />
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
