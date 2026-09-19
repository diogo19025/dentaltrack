"use client";

import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Controle segmentado (réplica de `.segmented` do design — theme.css). Usado no
 * filtro de período do dashboard, no filtro de status dos leads, nas abas de
 * configurações e no tom de voz. Ativo = fundo `card` + texto `primary`.
 * A11y (QA-4.4): padrão de tabs — setas movem a seleção, tabindex rotativo.
 *
 * O indicador ativo desliza entre as opções por `clip-path`: uma segunda
 * fileira, idêntica e decorativa, é desenhada por cima já no estilo "ativo"
 * e recortada ao retângulo da opção escolhida. Assim texto e fundo trocam de
 * cor no mesmo movimento, sem o cross-fade de dois estados sobrepostos. É
 * ação frequente, então o movimento é curto (150ms, ease-out); em
 * `prefers-reduced-motion` o recorte apenas salta.
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
  const listRef = useRef<HTMLDivElement>(null);
  const [clip, setClip] = useState<string | null>(null);

  // Mede a opção ativa e recorta a fileira decorativa a ela. Re-mede quando o
  // valor muda e quando o controle muda de tamanho (fonte, largura).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>(
        '[role="tab"][aria-selected="true"]',
      );
      // Sem layout (SSR, jsdom) não há o que recortar: fica o estado estático.
      if (!active || active.offsetWidth === 0) return setClip(null);
      const left = active.offsetLeft;
      const right = list.clientWidth - (left + active.offsetWidth);
      setClip(`inset(0 ${right}px 0 ${left}px round 6px)`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, options]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = options.findIndex((opt) => opt.value === value);
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>("[role=tab]")
      [next]?.focus();
  }

  const item =
    "rounded-[calc(var(--radius-md)-3px)] px-3.5 py-[7px] text-[13px] font-medium whitespace-nowrap";

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      ref={listRef}
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-[var(--radius-md)] bg-muted p-1",
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
            item,
            "outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.97]",
            // Sem medida ainda (1º paint, SSR), o próprio botão mostra o ativo.
            value === opt.value && !clip
              ? "bg-card text-primary shadow-[var(--shadow-xs)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}

      {clip && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center gap-0.5 p-1 transition-[clip-path] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          style={{ clipPath: clip }}
        >
          {options.map((opt) => (
            <span
              key={opt.value}
              className={cn(
                item,
                "bg-card text-primary shadow-[var(--shadow-xs)]",
              )}
            >
              {opt.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
