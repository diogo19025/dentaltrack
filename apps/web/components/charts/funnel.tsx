import type { Funnel as FunnelData } from "@dentaltrack/shared";

/**
 * Funil de conversão (FE-3.1) — barras com label/valor/%, espelha `Funnel` do
 * charts.jsx. Barras em CSS (não é gráfico de eixo); largura = % do topo.
 */
export function Funnel({ data }: { data: FunnelData }) {
  const stages = [
    { label: "Conversas iniciadas", value: data.started },
    { label: "Conversas engajadas", value: data.engaged },
    { label: "Agendamentos", value: data.scheduled },
  ];
  const max = stages[0].value || 1;

  return (
    <div className="flex flex-col gap-2.5">
      {stages.map((s) => {
        const pct = Math.round((s.value / max) * 100);
        return (
          <div key={s.label}>
            <div className="mb-1.5 flex justify-between">
              <span className="text-[13px] font-medium">{s.label}</span>
              <span className="tabular text-[13px] text-muted-foreground">
                {s.value.toLocaleString("pt-BR")} <span className="opacity-65">· {pct}%</span>
              </span>
            </div>
            <div className="h-8 overflow-hidden rounded-lg bg-muted">
              <div
                className="bar-grow h-full rounded-lg"
                style={{
                  width: `${pct}%`,
                  background:
                    "linear-gradient(90deg, var(--chart-1), color-mix(in oklab, var(--chart-1) 78%, white))",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
