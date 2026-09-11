"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarClock,
  Filter,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AssistantCard } from "@/components/shell/assistant-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLeads } from "@/hooks/use-leads";
import { useSettings } from "@/hooks/use-settings";
import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { OwnerOnly, useRole } from "@/components/auth/role-context";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/funil", label: "Funil", icon: Filter },
  { href: "/agenda", label: "Agenda", icon: CalendarClock },
  { href: "/settings", label: "Configurações", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar({
  userEmail,
  clinicName,
  sessionId,
}: {
  userEmail: string;
  clinicName?: string;
  /** Id do login atual — o cartão "Assistente ativo" reaparece quando ele muda. */
  sessionId?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isOwner } = useRole();
  const { data: leadsData } = useLeads();
  const { data: settings } = useSettings();
  const leadsBadge = leadsData?.summary.total || 0;
  // Marca do shell = nome da empresa (multi-tenant); fallback: marca da plataforma.
  const brandName =
    clinicName?.trim() || settings?.clinicName?.trim() || brand.name;

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
          aria-label={`${brandName} — ir para o Dashboard`}
          className="inline-flex max-w-full rounded-md outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Logo name={brandName} mark={26} font={18} />
        </Link>
      </div>

      <div className="px-3 pt-1">
        <div className="px-[10px] pb-2 pt-[10px] text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Menu
        </div>
        <nav className="flex flex-col gap-[3px]">
          {NAV.filter((item) => item.href !== "/settings" || isOwner).map(
            (item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              const badge =
                item.href === "/leads" && leadsBadge > 0
                  ? String(leadsBadge)
                  : undefined;
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
                    style={{
                      color: active
                        ? "var(--primary)"
                        : "var(--muted-foreground)",
                    }}
                  />
                  <span className="flex-1">{item.label}</span>
                  {badge && (
                    <span
                      className={cn(
                        "tabular rounded-full px-[7px] py-[2px] text-[11px] font-medium",
                        active
                          ? "bg-primary text-white"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {badge}
                    </span>
                  )}
                </Link>
              );
            },
          )}
        </nav>
      </div>

      <div className="flex-1" />

      <OwnerOnly>
        <AssistantCard sessionId={sessionId} />
      </OwnerOnly>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-[10px] rounded-md px-2 py-[6px]">
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary-tint text-[13px] font-semibold text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">
              {userEmail}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {settings?.clinicName?.trim() || clinicName || "Painel"}
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={logout}
                aria-label="Sair"
              >
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
