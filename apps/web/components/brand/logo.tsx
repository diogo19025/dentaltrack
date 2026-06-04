import type { CSSProperties, SVGProps } from "react";

type ToothMarkProps = SVGProps<SVGSVGElement> & {
  size?: number;
  strokeWidth?: number;
};

/** Símbolo de dente (molar estilizado) — 1:1 com icons.jsx do handoff. */
export function ToothMark({ size = 22, strokeWidth = 1.8, ...props }: ToothMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 5.5c-1.7-1.6-3.7-2.2-5.2-1.3C5 5.3 4.4 7.6 4.9 10.2c.3 1.5.4 2.4.5 3.8.2 2.3.4 4 .9 5.4.3.9.8 1.6 1.4 1.6.8 0 1-1 1.3-2.5.3-1.4.6-2.6 1.6-2.6h.8c1 0 1.3 1.2 1.6 2.6.3 1.5.5 2.5 1.3 2.5.6 0 1.1-.7 1.4-1.6.5-1.4.7-3.1.9-5.4.1-1.4.2-2.3.5-3.8.5-2.6-.1-4.9-1.9-6C15.7 3.3 13.7 3.9 12 5.5Z" />
    </svg>
  );
}

type LogoProps = {
  compact?: boolean;
  mark?: number;
  font?: number;
  style?: CSSProperties;
};

/** Logo completo (marca teal + wordmark "DentalTrack"). */
export function Logo({ compact = false, mark = 30, font = 18, style }: LogoProps) {
  return (
    <div className="flex items-center gap-[11px]" style={style}>
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
        <ToothMark size={mark} strokeWidth={1.9} style={{ fill: "rgba(255,255,255,0.08)" }} />
      </span>
      {!compact && (
        <span
          className="font-semibold tracking-[-0.02em] text-foreground"
          style={{ fontSize: font }}
        >
          Dental<span style={{ color: "var(--primary)" }}>Track</span>
        </span>
      )}
    </div>
  );
}
