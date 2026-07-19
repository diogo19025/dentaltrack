"use client";

import { usePathname } from "next/navigation";
import { Bell, ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/use-settings";
import { brand } from "@/lib/brand";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/chat": "Chat",
  "/leads": "Leads",
  "/funil": "Funil",
  "/settings": "Configurações",
};

function titleFor(pathname: string, fallback: string) {
  if (pathname === "/") return TITLES["/"];
  const key = Object.keys(TITLES).find((k) => k !== "/" && pathname.startsWith(k));
  return key ? TITLES[key] : fallback;
}

export function Topbar() {
  const pathname = usePathname();
  const { data: settings } = useSettings();
  // Raiz do breadcrumb = nome da clínica (multi-tenant); fallback: marca da plataforma.
  const brandName = settings?.clinicName?.trim() || brand.name;
  const title = titleFor(pathname, brandName);

  return (
    <header
      className="sticky top-0 z-20 flex h-16 flex-none items-center gap-4 border-b border-border px-7"
      style={{
        background: "color-mix(in srgb, var(--card) 80%, transparent)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex min-w-0 items-center gap-2 text-[13.5px] text-muted-foreground">
        <span className="truncate">{brandName}</span>
        <ChevronRight className="size-[14px] flex-none" />
        <span className="font-medium text-foreground">{title}</span>
      </div>

      <div className="flex-1" />

      <div className="relative hidden w-[260px] sm:block">
        <Search className="pointer-events-none absolute left-[13px] top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Buscar conversas e leads" placeholder="Buscar conversas, leads…" className="pl-10" />
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <span className="relative inline-flex">
            <Button variant="secondary" size="icon-sm" aria-label="Notificações">
              <Bell />
            </Button>
            <span
              className="absolute right-[6px] top-[6px] size-2 rounded-full"
              style={{ background: "var(--destructive)", border: "2px solid var(--card)" }}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>Notificações</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-sm" aria-label="Iniciar conversa de teste">
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Iniciar conversa de teste</TooltipContent>
      </Tooltip>
    </header>
  );
}
