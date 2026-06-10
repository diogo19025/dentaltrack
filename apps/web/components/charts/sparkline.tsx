"use client";

import { useId } from "react";
import { Area, AreaChart } from "recharts";

/**
 * Sparkline (FE-3.1) — área teal suave, espelha `Sparkline` do charts.jsx:
 * 210×34 fixos e traçado linear (ponto a ponto, não curva).
 * Usado nos 4 primeiros KPI cards do dashboard.
 */
export function Sparkline({
  data,
  color = "var(--primary)",
  width = 210,
  height = 34,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const rawId = useId();
  const id = `spark-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const rows = data.map((v, i) => ({ i, v }));

  return (
    <AreaChart
      width={width}
      height={height}
      data={rows}
      margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.16} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <Area
        type="linear"
        dataKey="v"
        stroke={color}
        strokeWidth={1.8}
        fill={`url(#${id})`}
        dot={false}
        isAnimationActive={false}
      />
    </AreaChart>
  );
}
