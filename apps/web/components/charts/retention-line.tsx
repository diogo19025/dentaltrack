"use client";

import type { Retention } from "@dentaltrack/shared";
import {
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS_TICK = {
  fontSize: 11,
  letterSpacing: "0.01em",
  fill: "var(--muted-foreground)",
} as const;
/**
 * Marcador só onde há valor. Uma série no zero desenhada ponto a ponto vira um
 * pontilhado denso colado no eixo, e o eixo parece sujo.
 */
function dotIfValue(color: string) {
  return function Dot(props: {
    cx?: number;
    cy?: number;
    value?: number;
    index?: number;
  }) {
    if (!props.value || props.cx == null || props.cy == null) {
      return <g key={props.index} />;
    }
    return (
      <circle
        key={props.index}
        cx={props.cx}
        cy={props.cy}
        r={2.6}
        fill={color}
        stroke="var(--card)"
        strokeWidth={1.4}
      />
    );
  };
}

/**
 * Linha de 2 séries (recorrentes × abandonos) da seção "Abandono × Recorrência".
 * Mesma anatomia do LineChart do handoff (grid pontilhado, eixos discretos);
 * cores chart-1 (recorrente, sólida) × chart-2 (abandono, tracejada) — o
 * tracejado diferencia as séries também sem cor (CVD/impressão).
 */
export function RetentionLine({
  data,
  height = 230,
}: {
  data: Retention;
  height?: number;
}) {
  const rows = data.labels.map((label, i) => ({
    label,
    recurrent: data.recurrent[i] ?? 0,
    abandoned: data.abandoned[i] ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RLineChart
        data={rows}
        margin={{ top: 6, right: 8, bottom: 0, left: -18 }}
      >
        <CartesianGrid
          vertical={false}
          strokeDasharray="3 4"
          stroke="var(--border)"
        />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          width={40}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-md)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--muted-foreground)", marginBottom: 2 }}
        />
        <Line
          type="linear"
          dataKey="recurrent"
          name="Clientes recorrentes"
          stroke="var(--chart-1)"
          strokeWidth={2.4}
          dot={dotIfValue("var(--chart-1)")}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="abandoned"
          name="Abandonos"
          stroke="var(--chart-2)"
          strokeWidth={2.4}
          strokeDasharray="7 4"
          dot={dotIfValue("var(--chart-2)")}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </RLineChart>
    </ResponsiveContainer>
  );
}
