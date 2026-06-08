import type { TopTag } from "@dentaltrack/shared";
import { Tag } from "@/components/ui/tag";

/**
 * Barras horizontais das top tags (FE-3.1) — espelha `HBars` do charts.jsx:
 * pílula da tag à esquerda, barra na cor da tag, valor à direita.
 */
export function HBars({ data }: { data: TopTag[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex flex-col gap-3.5">
      {data.map((d) => (
        <div key={d.name} className="flex items-center gap-3">
          <div className="flex w-[116px] flex-none justify-end">
            <Tag name={d.name} color={d.color} />
          </div>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="bar-grow h-full rounded-full"
              style={{ width: `${(d.value / max) * 100}%`, background: `var(--tag-${d.color}-fg)` }}
            />
          </div>
          <span className="tabular w-[30px] text-right text-[13px] text-muted-foreground">
            {d.value}
          </span>
        </div>
      ))}
    </div>
  );
}
