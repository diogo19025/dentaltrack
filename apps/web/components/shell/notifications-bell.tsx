"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarCheck2,
  MessageCircle,
  TriangleAlert,
  UserMinus,
  UserPlus,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import type { NotificationItem, NotificationType } from "@dentaltrack/shared";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useMarkNotificationsSeen,
  useNotifications,
} from "@/hooks/use-notifications";
import { timeAgo } from "@/lib/format";

/**
 * Sino de notificações do topbar (F11) — padrão dos CRMs de referência
 * (HubSpot/Pipedrive): badge com a contagem de não lidas, painel ancorado no
 * botão com os eventos recentes e clique levando para a tela do contexto.
 * Abrir o painel marca tudo como visto (o sino é um resumo, não uma caixa de
 * tarefas); os pontos de "não lida" permanecem até o próximo polling.
 */

const ICONS: Record<NotificationType, LucideIcon> = {
  conversa_iniciada: MessageCircle,
  lead_capturado: UserPlus,
  agendamento_criado: CalendarCheck2,
  conversa_abandonada: UserMinus,
  automacao_falhou: TriangleAlert,
  whatsapp_desconectado: WifiOff,
};

/** Para onde o clique leva — a tela onde o dono age sobre aquele evento. */
const ROUTES: Record<NotificationType, string> = {
  conversa_iniciada: "/",
  lead_capturado: "/leads",
  agendamento_criado: "/agenda",
  conversa_abandonada: "/leads",
  automacao_falhou: "/agenda",
  whatsapp_desconectado: "/settings?tab=whatsapp",
};

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data, isLoading } = useNotifications();
  const markSeen = useMarkNotificationsSeen();

  const unread = data?.unreadCount ?? 0;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && unread > 0) markSeen.mutate();
  }

  function onItemClick(item: NotificationItem) {
    setOpen(false);
    router.push(ROUTES[item.type]);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <span className="relative inline-flex">
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label={
              unread > 0 ? `Notificações (${unread} não lidas)` : "Notificações"
            }
          >
            <Bell />
          </Button>
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white"
              style={{
                background: "var(--destructive)",
                border: "2px solid var(--card)",
                boxSizing: "content-box",
              }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] p-0"
        aria-label="Notificações recentes"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Notificações</span>
          <span className="text-xs text-muted-foreground">últimos 7 dias</span>
        </div>

        {isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
            <Bell className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Nada por aqui</p>
            <p className="text-xs text-muted-foreground">
              Novas conversas, leads, agendamentos e avisos do assistente
              aparecem aqui.
            </p>
          </div>
        ) : (
          <ul role="list" className="max-h-[420px] overflow-y-auto py-1">
            {data.items.map((item) => {
              const Icon = ICONS[item.type];
              const alert =
                item.type === "automacao_falhou" ||
                item.type === "whatsapp_desconectado";
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(item)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <span
                      className="mt-0.5 flex size-8 flex-none items-center justify-center rounded-full"
                      style={{
                        background: alert
                          ? "color-mix(in srgb, var(--destructive) 12%, transparent)"
                          : "color-mix(in srgb, var(--primary) 12%, transparent)",
                        color: alert ? "var(--destructive)" : "var(--primary)",
                      }}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13.5px] font-medium">
                          {item.title}
                        </span>
                        <span className="flex-none text-xs text-muted-foreground">
                          {timeAgo(item.occurredAt)}
                        </span>
                      </span>
                      {item.description && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </span>
                    {item.unread && (
                      <span
                        aria-label="Não lida"
                        className="mt-2 size-2 flex-none rounded-full"
                        style={{ background: "var(--primary)" }}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
