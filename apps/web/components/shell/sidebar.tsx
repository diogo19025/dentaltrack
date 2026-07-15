"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Filter,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLeads } from "@/hooks/use-leads";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/funil", label: "Funil", icon: Filter },
  { href: "/settings", label: "Configurações", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar({
  userEmail,
  clinicName = "Painel da clínica",
}: {
  userEmail: string;
  clinicName?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: leadsData } = useLeads();
  const leadsBadge = leadsData?.summary.total || 0;

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const initials = userEmail.slice(0, 2).toUpperCase();

  return (
    <aside
      className="flex h-full flex-none flex-col border-r border-border bg-card"
      style={{ width: "var(--sidebar-w)" }}
    >
      <div className="px-5 pb-[18px] pt-5">
        <Link
          href="/"
          aria-label="DentalTrack — ir para o Dashboard"
          className="inline-flex rounded-md outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Logo mark={26} font={18} />
        </Link>
      </div>

      <div className="px-3 pt-1">
        <div className="px-[10px] pb-2 pt-[10px] text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Menu
        </div>
        <nav className="flex flex-col gap-[3px]">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            const badge = item.href === "/leads" && leadsBadge > 0 ? String(leadsBadge) : undefined;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-[11px] rounded-md px-[11px] py-[10px] text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  active
                    ? "bg-primary-tint font-semibold text-primary"
                    : "font-medium text-secondary-foreground hover:bg-accent",
                )}
              >
                <Icon
                  className="size-[18px] flex-none"
                  style={{ color: active ? "var(--primary)" : "var(--muted-foreground)" }}
                />
                <span className="flex-1">{item.label}</span>
                {badge && (
                  <span
                    className={cn(
                      "tabular rounded-full px-[7px] py-[2px] text-[11px] font-medium",
                      active ? "bg-primary text-white" : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex-1" />

      <div className="px-[14px] pb-3">
        <div
          className="rounded-lg p-[14px]"
          style={{ background: "var(--primary-tint)", border: "1px solid var(--primary-tint-strong)" }}
        >
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="size-[15px]" style={{ color: "var(--primary)" }} />
            <span className="text-[13px] font-semibold" style={{ color: "var(--primary-active)" }}>
              Assistente ativo
            </span>
          </div>
          <p
            className="mb-[10px] text-xs leading-[1.45]"
            style={{ color: "var(--primary-active)", opacity: 0.82 }}
          >
            O bot está online e respondendo pacientes no canal Web.
          </p>
          <Link
            href="/settings"
            className="flex items-center justify-center gap-1 rounded-[var(--radius-sm)] bg-card py-2 text-[12.5px] font-semibold text-primary"
            style={{ border: "1px solid var(--primary-tint-strong)" }}
          >
            Configurar
          </Link>
        </div>
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-[10px] rounded-md px-2 py-[6px]">
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary-tint text-[13px] font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">{userEmail}</div>
            <div className="truncate text-xs text-muted-foreground">{clinicName}</div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={logout} aria-label="Sair">
                <LogOut />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Sair</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
