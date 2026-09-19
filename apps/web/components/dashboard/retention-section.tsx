"use client";

import type { Retention } from "@dentaltrack/shared";
import { RetentionLine } from "@/components/charts/retention-line";
import { Card } from "@/components/ui/card";

/**
 * Seção "Abandono × Recorrência" do dashboard — fora do handoff, seguindo o
 * design system. Compara por dia os atendimentos abandonados com os clientes
 * que voltaram para agendar de novo (recorrentes), com os totais do período e a
 * taxa de recorrência da empresa (GET /metrics · `retention`).
 */
export function RetentionSection({
  retention,
  rangeDaysLabel,
}: {
  retention: Retention;
  rangeDaysLabel: string;
}) {
  const pct = `${Math.round(retention.recurrenceRate * 100)}%`;
  const hasData =
    retention.abandonedTotal > 0 ||
    retention.recurrentLeads > 0 ||
    retention.recurrent.some((v) => v > 0);

  return (
    <Card className="gap-0 p-[22px_24px]">
      <div className="mb-[18px] flex items-start justify-between gap-3 max-[680px]:flex-col">
        <div>
          <div className="text-base font-semibold tracking-[-0.01em]">
            Abandono × Recorrência
          </div>
          <div className="mt-[3px] text-[13px] text-muted-foreground">
            Atendimentos abandonados × clientes que voltaram a agendar · últimos{" "}
            {rangeDaysLabel} dias
          </div>
        </div>
        <RetentionLegend />
      </div>

      <div className="mb-[18px] grid grid-cols-3 gap-[18px] max-[680px]:grid-cols-1">
        <RetentionStat
          label="Clientes recorrentes"
          value={retention.recurrentLeads.toLocaleString("pt-BR")}
          hint="Voltaram e agendaram de novo no período"
          color="var(--chart-1)"
        />
        <RetentionStat
          label="Atendimentos abandonados"
          value={retention.abandonedTotal.toLocaleString("pt-BR")}
          hint="Conversas iniciadas e não concluídas no período"
          color="var(--chart-2)"
        />
        <RetentionStat
          label="Taxa de recorrência"
          value={pct}
          hint="Dos clientes que já agendaram, quantos voltaram"
        />
      </div>

      {hasData ? (
        <RetentionLine data={retention} />
      ) : (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          Sem abandonos nem retornos no período. Os retornos aparecem quando um
          cliente que já agendou volta para marcar outro atendimento.
        </p>
      )}
    </Card>
  );
}

/** Legenda das 2 séries (recorrente sólida · abandono tracejada). */
function RetentionLegend() {
  return (
    <div className="flex gap-4">
      <span className="flex items-center gap-[7px] text-[13px] text-muted-foreground">
        <span
          className="size-2.5 rounded-[3px]"
          style={{ background: "var(--chart-1)" }}
        />
        Recorrentes
      </span>
      <span className="flex items-center gap-[7px] text-[13px] text-muted-foreground">
        <svg width="14" height="10" aria-hidden="true">
          <line
            x1="0"
            y1="5"
            x2="14"
            y2="5"
            stroke="var(--chart-2)"
            strokeWidth="2.4"
            strokeDasharray="4 2.5"
          />
        </svg>
        Abandonos
      </span>
    </div>
  );
}

/** Um número-resumo da seção (rótulo + valor + explicação). */
function RetentionStat({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint: string;
  color?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        {color && (
          <span
            className="size-2 rounded-full"
            style={{ background: color }}
            aria-hidden="true"
          />
        )}
        {label}
      </div>
      <div className="tabular mt-1 text-[26px] font-semibold tracking-[-0.02em]">
        {value}
      </div>
      <div className="mt-[2px] text-[12px] tracking-[0.01em] text-muted-foreground">
        {hint}
      </div>
    </div>
  );
}
