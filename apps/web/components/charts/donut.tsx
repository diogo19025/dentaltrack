"use client";

import type { ConversationStatus, StatusSlice } from "@dentaltrack/shared";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

const META: Record<ConversationStatus, { label: string; color: string }> = {
  em_andamento: { label: "Em andamento", color: "var(--status-andamento)" },
  agendada: { label: "Agendada", color: "var(--status-agendada)" },
  abandonada: { label: "Abandonada", color: "var(--status-abandonada)" },
};

/**
 * Donut de status (FE-3.1) — `PieChart` com innerRadius + total no centro e
 * legenda com % à direita, espelha `Donut` do charts.jsx. Renderiza um anel
 * `muted` ao fundo (visível quando vazio / nos vãos).
 */
export function Donut({ data, size = 168 }: { data: StatusSlice[]; size?: number }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  // Anel de 16px centrado como no mock (raio até size/2-16, strokeWidth 16).
  const inner = size / 2 - 24;
  const outer = size / 2 - 8;

  return (
    <div className="flex items-center gap-6">
      <div className="relative flex-none" style={{ width: size, height: size }}>
        <ResponsiveContainer width={size} height={size}>
          <PieChart>
            {/* Trilho de fundo (sempre visível). */}
            <Pie
              data={[{ value: 1 }]}
              dataKey="value"
              innerRadius={inner}
              outerRadius={outer}
              fill="var(--muted)"
              stroke="none"
              isAnimationActive={false}
            />
            {total > 0 && (
              <Pie
                data={data}
                dataKey="value"
                innerRadius={inner}
                outerRadius={outer}
                cornerRadius={8}
                stroke="none"
                startAngle={90}
                endAngle={-270}
              >
                {data.map((s) => (
                  <Cell key={s.status} fill={META[s.status].color} />
                ))}
              </Pie>
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-[26px] font-semibold leading-none">{total}</span>
          <span className="mt-1 text-[11px] text-muted-foreground">conversas</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {data.map((s) => (
          <div key={s.status} className="flex items-center gap-[9px]">
            <span className="size-2.5 flex-none rounded-[3px]" style={{ background: META[s.status].color }} />
            <span className="text-[13px]">{META[s.status].label}</span>
            <span className="tabular ml-1 text-[13px] text-muted-foreground">
              {total ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
