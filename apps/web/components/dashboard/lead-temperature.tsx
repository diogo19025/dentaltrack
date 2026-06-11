"use client";

import Link from "next/link";
import type { LeadDto } from "@dentaltrack/shared";
import { ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { initials } from "@/lib/format";
import { TEMPERATURE_META, TEMPERATURE_ORDER } from "@/lib/lead-temperature";

/**
 * Seção "Temperatura dos leads" do dashboard (FE-3.7) — fora do handoff,
 * seguindo o design system. Três colunas (quente/médio/fraco) com o top 3 de
 * cada faixa por score (GET /leads · `lead-scoring.ts`). Clicar num lead abre
 * o painel de detalhe (FE-3.8) via `onLeadClick`.
 */

const TOP_PER_BUCKET = 3;

const BUCKETS = TEMPERATURE_ORDER.map((key) => ({
  key,
  ...TEMPERATURE_META[key],
}));

/** Score desc; desempate por captura mais recente (ISO compara lexicográfico). */
const byScoreDesc = (a: LeadDto, b: LeadDto) =>
  b.score - a.score || b.createdAt.localeCompare(a.createdAt);

export function LeadTemperatureSection({
  leads,
  isLoading,
  onLeadClick,
}: {
  leads: LeadDto[] | undefined;
  isLoading: boolean;
  onLeadClick?: (lead: LeadDto) => void;
}) {
  return (
    <Card className="anim-fade-up gap-0 p-[22px_24px]">
      <div className="mb-[18px] flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold tracking-[-0.01em]">Temperatura dos leads</div>
          <div className="mt-[3px] text-[13px] text-muted-foreground">
            Chance de conversão pelo comportamento na conversa
          </div>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/leads">
            Ver todos <ChevronRight className="size-4" />
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-[18px] max-[980px]:grid-cols-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[140px] w-full" />
          ))}
        </div>
      ) : !leads || leads.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          Nenhum lead capturado ainda. Eles aparecem aqui quando o agente registra um contato.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-[18px] max-[980px]:grid-cols-1">
          {BUCKETS.map((bucket) => {
            const bucketLeads = leads
              .filter((l) => l.temperature === bucket.key)
              .sort(byScoreDesc);
            const top = bucketLeads.slice(0, TOP_PER_BUCKET);
            const rest = bucketLeads.length - top.length;

            return (
              <div key={bucket.key}>
                <div
                  className="flex items-center gap-2"
                  aria-label={`${bucket.label}: ${bucketLeads.length}`}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ background: bucket.fg }}
                    aria-hidden="true"
                  />
                  <span className="text-[13px] font-semibold">{bucket.label}</span>
                  <span
                    className="tabular rounded-full px-2 py-[2px] text-[12px] font-semibold"
                    style={{ background: bucket.bg, color: bucket.fg }}
                  >
                    {bucketLeads.length}
                  </span>
                </div>
                <div className="mt-[3px] text-[12px] text-muted-foreground">{bucket.hint}</div>

                {top.length > 0 ? (
                  <ul role="list" className="mt-3 flex flex-col gap-3">
                    {top.map((lead) => (
                      <li key={lead.id}>
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          onClick={() => onLeadClick?.(lead)}
                          className="-m-1.5 w-[calc(100%+12px)] rounded-[10px] p-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                        >
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-8">
                              <AvatarFallback className="bg-secondary text-[12px] font-semibold text-muted-foreground">
                                {initials(lead.name, "L")}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13.5px] font-medium">
                                {lead.name ?? "Lead"}
                              </div>
                              <div className="truncate text-[12px] text-muted-foreground">
                                {lead.interest ?? "—"}
                              </div>
                            </div>
                            <span
                              className="tabular text-[13px] font-semibold"
                              style={{ color: bucket.fg }}
                            >
                              {lead.score}
                            </span>
                          </div>
                          <div
                            className="mt-1.5 h-1 overflow-hidden rounded-full"
                            style={{ background: "var(--muted)" }}
                            aria-hidden="true"
                          >
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${lead.score}%`, background: bucket.fg }}
                            />
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[13px] text-muted-foreground">
                    Nenhum lead nesta faixa.
                  </p>
                )}

                {rest > 0 && (
                  <div className="mt-2 text-[12px] text-muted-foreground">
                    +{rest} {rest === 1 ? "outro" : "outros"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
