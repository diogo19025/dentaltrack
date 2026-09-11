"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Plus, Search, WifiOff } from "lucide-react";
import { NotificationsBell } from "@/components/shell/notifications-bell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { brand } from "@/lib/brand";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import { useRole } from "@/components/auth/role-context";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/chat": "Chat",
  "/leads": "Leads",
  "/funil": "Funil",
  "/settings": "Configurações",
};

function titleFor(pathname: string) {
  if (pathname === "/") return TITLES["/"];
  const key = Object.keys(TITLES).find(
    (k) => k !== "/" && pathname.startsWith(k),
  );
  return key ? TITLES[key] : brand.name;
}

export function Topbar() {
  const pathname = usePathname();
  // Raiz do breadcrumb = nome do produto (plataforma), nunca o do empreendimento.
  const title = titleFor(pathname);

  return (
    <div className="sticky top-0 z-20 flex-none">
      <header
        className="flex h-16 items-center gap-4 border-b border-border px-7"
        style={{
          background: "color-mix(in srgb, var(--card) 80%, transparent)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
          <span>{brand.name}</span>
          <ChevronRight className="size-[14px]" />
          <span className="font-medium text-foreground">{title}</span>
        </div>

        <div className="flex-1" />

        <div className="relative hidden w-[260px] sm:block">
          <Search className="pointer-events-none absolute left-[13px] top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar conversas e leads"
            placeholder="Buscar conversas, leads…"
            className="pl-10"
          />
        </div>

        <NotificationsBell />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" aria-label="Iniciar conversa de teste">
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Iniciar conversa de teste</TooltipContent>
        </Tooltip>
      </header>
      <WhatsappStatusBanner />
    </div>
  );
}

/**
 * Aviso global de que a sessão do WhatsApp caiu.
 *
 * **Só para `desconectado`, e não para "diferente de conectado".** Enquanto o
 * estado é `aguardando_leitura` o dono está na tela de pareamento, olhando o
 * QR: a faixa vermelha dizia que algo deu errado no exato momento em que ele
 * estava fazendo dar certo, e o link "Ver conexão" apontava para a página em
 * que ele já estava. Um alerta que aparece durante a operação normal ensina a
 * ignorá-lo — e é o mesmo alerta que precisa funcionar quando a sessão cair de
 * verdade.
 */
export function WhatsappStatusBanner() {
  const { isOwner } = useRole();
  const { data } = useWhatsappConnection(isOwner);
  if (!isOwner) return null;
  if (data?.state !== "desconectado") return null;

  return (
    <div
      role="alert"
      className="flex min-h-9 items-center justify-center gap-2 border-b border-destructive/20 px-4 py-2 text-center text-[12.5px] text-destructive"
      style={{
        background: "color-mix(in srgb, var(--destructive) 8%, var(--card))",
      }}
    >
      <WifiOff className="size-4 shrink-0" />
      <span>
        A sessão do WhatsApp caiu — o assistente não está recebendo mensagens.
      </span>
      <Link
        href="/settings?tab=whatsapp"
        className="font-semibold underline underline-offset-2"
      >
        Reconectar
      </Link>
    </div>
  );
}
