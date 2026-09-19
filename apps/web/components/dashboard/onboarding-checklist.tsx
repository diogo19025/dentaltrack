"use client";

import Link from "next/link";
import { ChevronRight, CircleCheck, Circle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOnboardingChecklist } from "@/hooks/use-onboarding-checklist";
import { cn } from "@/lib/utils";

/**
 * Card "Primeiros passos" do dashboard (P1.1) — fora do handoff, seguindo o
 * design system (produto.md § Design). Lista o que falta configurar, derivado
 * do estado real (GET /onboarding/checklist), e **some sozinho** quando tudo
 * está feito. Erro de carregamento também some: um checklist é ajuda, não
 * alarme — o dashboard já tem o seu próprio estado de erro.
 */
export function OnboardingChecklist() {
  const { data, isLoading, isError } = useOnboardingChecklist();

  if (isError) return null;
  if (isLoading || !data) {
    return <Skeleton className="mb-[18px] h-[132px] w-full" />;
  }
  if (data.complete) return null;

  const pct = Math.round((data.done / data.total) * 100);

  return (
    <Card
      data-testid="onboarding-checklist"
      className="mb-[18px] gap-0 p-[22px_24px]"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold tracking-[-0.01em]">
            Primeiros passos
          </div>
          <div className="mt-[3px] text-[13px] text-muted-foreground">
            Deixe o assistente pronto para atender de verdade.
          </div>
        </div>
        <div className="tabular text-[13px] font-medium text-muted-foreground">
          {data.done} de {data.total}
        </div>
      </div>

      <div
        role="progressbar"
        aria-label="Progresso da configuração"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary"
      >
        {/* scaleX em vez de width: fica no compositor e não relayouta a
          linha inteira a cada passo concluído. */}
        <div
          className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-[400ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>

      <ul className="grid grid-cols-3 gap-x-[18px] gap-y-2 max-[980px]:grid-cols-2 max-[680px]:grid-cols-1">
        {data.items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-label={`${item.label}${item.done ? " (feito)" : ""}`}
              className={cn(
                "group flex items-start gap-2.5 rounded-[var(--radius-sm)] px-2 py-2 -mx-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                item.done && "text-muted-foreground",
              )}
            >
              {item.done ? (
                <CircleCheck className="mt-0.5 size-4 flex-none text-primary" />
              ) : (
                <Circle className="mt-0.5 size-4 flex-none text-border-strong" />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm font-medium",
                    item.done && "line-through decoration-border-strong",
                  )}
                >
                  {item.label}
                </span>
                {!item.done && (
                  <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </span>
              {!item.done && (
                <ChevronRight className="mt-0.5 size-4 flex-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
