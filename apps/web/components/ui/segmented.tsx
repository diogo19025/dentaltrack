"use client";

import { cn } from "@/lib/utils";

/**
 * Controle segmentado (réplica de `.segmented` do design — theme.css). Usado no
 * filtro de período do dashboard, no filtro de status dos leads, nas abas de
 * configurações e no tom de voz. Ativo = fundo `card` + texto `primary`.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex items-center gap-0.5 rounded-[var(--radius-md)] bg-muted p-1", className)}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-[calc(var(--radius-md)-3px)] px-3.5 py-[7px] text-[13px] font-medium transition-all",
            value === opt.value
              ? "bg-card text-primary shadow-[var(--shadow-xs)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
