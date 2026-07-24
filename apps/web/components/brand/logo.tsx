import type { CSSProperties } from "react";
import { brand, brandInitials } from "@/lib/brand";

type BrandMarkProps = {
  /** Nome do qual derivar as iniciais (default: marca da plataforma). */
  name?: string;
  /** Tamanho de referência do glifo (px) — combina com o quadro que o envolve. */
  size?: number;
  style?: CSSProperties;
  className?: string;
};

/**
 * Símbolo da marca — monograma neutro (whitelabel). Renderiza as iniciais do
 * nome, pensado para ficar dentro do quadro teal do design (ver `Logo` e o
 * painel de marca do login). Sem qualquer referência a um segmento específico.
 */
export function BrandMark({ name = brand.name, size = 22, style, className }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        fontSize: Math.round(size * 0.62),
        fontWeight: 700,
        letterSpacing: "-0.03em",
        lineHeight: 1,
        ...style,
      }}
    >
      {brandInitials(name)}
    </span>
  );
}

type LogoProps = {
  /** Nome exibido no wordmark (default: marca da plataforma; no shell, a empresa). */
  name?: string;
  compact?: boolean;
  mark?: number;
  font?: number;
  style?: CSSProperties;
};

/** Logo completo (marca teal + wordmark). */
export function Logo({ name = brand.name, compact = false, mark = 30, font = 18, style }: LogoProps) {
  return (
    <div className="flex min-w-0 items-center gap-[11px]" style={style}>
      <span
        className="flex shrink-0 items-center justify-center text-white"
        style={{
          width: mark + 12,
          height: mark + 12,
          borderRadius: 11,
          background: "var(--primary)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <BrandMark name={name} size={mark} />
      </span>
      {!compact && (
        <span
          className="min-w-0 truncate font-semibold tracking-[-0.02em] text-foreground"
          style={{ fontSize: font }}
        >
          {name}
        </span>
      )}
    </div>
  );
}
