"use client";

import type { LineSeries } from "@dentaltrack/shared";
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
 * Linha de 2 séries (bot × cliente) — FE-3.1, espelha `LineChart` do
 * charts.jsx: traçado linear (ponto a ponto) com marcador em todo ponto,
 * grid horizontal pontilhado, eixos discretos, cores chart-1/3.
 *
 * Sem animação de dados: a série muda ao trocar o período e a cada refetch, e
 * redesenhar a linha inteira em 1,5s a cada atualização é latência, não
 * feedback (o donut e a sparkline já eram estáticos).
 */
export function LineChart({
  data,
  height = 250,
}: {
  data: LineSeries;
  height?: number;
}) {
  const rows = data.labels.map((label, i) => ({
    label,
    bot: data.bot[i] ?? 0,
    patient: data.patient[i] ?? 0,
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
          dataKey="bot"
          name="Bot"
          stroke="var(--chart-1)"
          strokeWidth={2.4}
          dot={dotIfValue("var(--chart-1)")}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="patient"
          name="Cliente"
          stroke="var(--chart-3)"
          strokeWidth={2.4}
          dot={dotIfValue("var(--chart-3)")}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </RLineChart>
    </ResponsiveContainer>
  );
}
