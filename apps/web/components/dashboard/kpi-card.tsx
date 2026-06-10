"use client";

import type { Kpi } from "@dentaltrack/shared";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";
import { Card } from "@/components/ui/card";

/**
 * Card de KPI do dashboard (FE-3.3) — espelha `KpiCard` do screen_dashboard.jsx:
 * ícone em quadrado primary-tint, badge de delta (▲/▼), número 30px tabular,
 * hint e sparkline (nos 4 primeiros). O valor já vem formatado da página.
 */
export function KpiCard({
  icon: Icon,
  label,
  value,
  kpi,
  hint,
  sparkColor,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  kpi: Kpi;
  hint?: string;
  sparkColor?: string;
}) {
  const up = kpi.deltaDir === "up";

  return (
    <Card className="lift flex flex-col gap-3.5 p-[22px_24px]">
      <div className="flex items-center justify-between">
        <span className="flex size-[38px] items-center justify-center rounded-[10px] bg-primary-tint text-primary">
          <Icon className="size-[19px]" />
        </span>
        {kpi.delta != null && (
          <span
            className="tabular inline-flex items-center gap-1.5 rounded-full px-2.5 py-[5px] text-[12px] font-semibold"
            style={
              up
                ? { background: "var(--success-tint)", color: "var(--success)" }
                : { background: "var(--destructive-tint)", color: "var(--destructive)" }
            }
          >
            {up ? <ArrowUp className="size-[13px]" /> : <ArrowDown className="size-[13px]" />}
            {kpi.delta}%
          </span>
        )}
      </div>

      <div>
        <div className="mb-[5px] text-[13px] text-muted-foreground">{label}</div>
        <div className="tabular text-[30px] font-semibold leading-none tracking-[-0.02em]">
          {value}
        </div>
        {hint && <div className="mt-[7px] text-[12px] text-muted-foreground">{hint}</div>}
      </div>

      {kpi.spark.length > 0 && (
        <div className="-mt-0.5" aria-hidden="true">
          <Sparkline data={kpi.spark} color={sparkColor} />
        </div>
      )}
    </Card>
  );
}
