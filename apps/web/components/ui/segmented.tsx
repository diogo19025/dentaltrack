"use client";

import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * Controle segmentado (réplica de `.segmented` do design — theme.css). Usado no
 * filtro de período do dashboard, no filtro de status dos leads, nas abas de
 * configurações e no tom de voz. Ativo = fundo `card` + texto `primary`.
 * A11y (QA-4.4): padrão de tabs — setas movem a seleção, tabindex rotativo.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = options.findIndex((opt) => opt.value === value);
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[var(--radius-md)] bg-muted p-1",
        className,
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          tabIndex={value === opt.value ? 0 : -1}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-[calc(var(--radius-md)-3px)] px-3.5 py-[7px] text-[13px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
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
