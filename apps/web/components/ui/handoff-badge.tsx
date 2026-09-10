import { Headphones } from "lucide-react";
import { cn } from "@/lib/utils";

/** Indica que uma pessoa, e não a IA, está no controle da conversa. */
export function HandoffBadge({
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[5px] text-[12px] font-medium",
        active
          ? "bg-primary-tint text-primary"
          : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Headphones className="size-3.5" />
      {active ? "Atendimento humano" : "IA atendendo"}
    </span>
  );
}
