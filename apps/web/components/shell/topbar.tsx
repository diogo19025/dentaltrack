"use client";

import { usePathname } from "next/navigation";
import { Bell, ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/chat": "Chat",
  "/leads": "Leads",
  "/settings": "Configurações",
};

function titleFor(pathname: string) {
  if (pathname === "/") return TITLES["/"];
  const key = Object.keys(TITLES).find((k) => k !== "/" && pathname.startsWith(k));
  return key ? TITLES[key] : "DentalTrack";
}

export function Topbar() {
  const pathname = usePathname();
  const title = titleFor(pathname);

  return (
    <header
      className="sticky top-0 z-20 flex h-16 flex-none items-center gap-4 border-b border-border px-7"
      style={{
        background: "color-mix(in srgb, var(--card) 80%, transparent)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
        <span>DentalTrack</span>
        <ChevronRight className="size-[14px]" />
        <span className="font-medium text-foreground">{title}</span>
      </div>

      <div className="flex-1" />

      <div className="relative hidden w-[260px] sm:block">
        <Search className="pointer-events-none absolute left-[13px] top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar conversas, leads…" className="h-10 pl-10" />
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <span className="relative inline-flex">
            <Button variant="outline" size="icon" aria-label="Notificações">
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
          <Button size="icon" aria-label="Iniciar conversa de teste">
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Iniciar conversa de teste</TooltipContent>
      </Tooltip>
    </header>
  );
}
