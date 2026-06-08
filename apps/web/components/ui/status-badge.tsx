import type { ConversationStatus } from "@dentaltrack/shared";
import { cn } from "@/lib/utils";

const LABEL: Record<ConversationStatus, string> = {
  em_andamento: "Em andamento",
  agendada: "Agendada",
  abandonada: "Abandonada",
};

/**
 * Badge de status de conversa (réplica de `StatusBadge` do design). Cores via
 * as classes `.status-*` (tint + texto) do globals.css.
 */
export function StatusBadge({
  status,
  className,
}: {
  status: ConversationStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[5px] text-[12px] font-medium",
        `status-${status}`,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {LABEL[status]}
    </span>
  );
}
