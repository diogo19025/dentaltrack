"use client";

import { useState } from "react";
import Link from "next/link";
import type { MetricsRange } from "@dentaltrack/shared";
import {
  ChevronRight,
  Clock,
  Download,
  Inbox,
  MessageCircle,
  RefreshCw,
  Target,
  Users,
} from "lucide-react";
import { Donut } from "@/components/charts/donut";
import { Funnel } from "@/components/charts/funnel";
import { HBars } from "@/components/charts/h-bars";
import { LineChart } from "@/components/charts/line-chart";
import { BookingsFootnote } from "@/components/dashboard/bookings-footnote";
import { ConversationDetailDialog } from "@/components/dashboard/conversation-detail-dialog";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { LeadDetailDialog } from "@/components/dashboard/lead-detail-dialog";
import { LeadTemperatureSection } from "@/components/dashboard/lead-temperature";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import { RetentionSection } from "@/components/dashboard/retention-section";
import { OwnerOnly } from "@/components/auth/role-context";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { HandoffBadge } from "@/components/ui/handoff-badge";
import { Tag } from "@/components/ui/tag";
import { useRecentConversations } from "@/hooks/use-conversations";
import { useLeads } from "@/hooks/use-leads";
import { useMetrics } from "@/hooks/use-metrics";
import { initials, timeAgo } from "@/lib/format";

/**
 * Dashboard (FE-3.2..3.5) — réplica 1:1 de `screen_dashboard.jsx`: filtro de
 * período + 6 KPI cards (com sparkline) + linha (bot×cliente) + donut de
 * status + funil + top tags + tabela de conversas recentes. Dados reais via
 * TanStack Query (GET /metrics, GET /conversations). Métricas: produto.md § Métricas.
 */

const RANGE_OPTIONS = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "50d", label: "50 dias" },
  { value: "90d", label: "90 dias" },
] as const;

const RANGE_DAYS_LABEL: Record<MetricsRange, string> = {
  "7d": "7",
  "30d": "30",
  "50d": "50",
  "90d": "90",
};

const intFmt = (n: number) => n.toLocaleString("pt-BR");
const pctFmt = (n: number) => `${Math.round(n * 100)}%`;

export default function DashboardPage() {
  const [range, setRange] = useState<MetricsRange>("50d");
  const { data, isLoading, isError, error, refetch } = useMetrics(range);
  const { data: recent } = useRecentConversations(6);
  const { data: leadsData, isLoading: leadsLoading } = useLeads();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral do atendimento e da conversão da sua empresa."
      >
        <Segmented
          aria-label="Período do dashboard"
          options={RANGE_OPTIONS}
          value={range}
          onChange={(v) => setRange(v as MetricsRange)}
        />
        <Button variant="secondary">
          <Download className="size-4" /> Exportar
        </Button>
      </PageHeader>

      {/* Primeiros passos (P1.1): o que falta configurar. Só o dono resolve
        (Configurações é owner-only) e o card some sozinho quando tudo está
        feito. Fica fora do gate das métricas: erro nelas não esconde a ajuda. */}
      <OwnerOnly>
        <OnboardingChecklist />
      </OwnerOnly>

      {isError && !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* KPIs */}
          <div className="stagger mb-[18px] grid grid-cols-3 gap-[18px] max-[1100px]:grid-cols-2 max-[680px]:grid-cols-1">
            <KpiCard
              icon={Users}
              label="Leads totais"
              value={intFmt(data.kpis.leads.value)}
              kpi={data.kpis.leads}
              hint="Pessoas capturadas no período"
            />
            <KpiCard
              icon={MessageCircle}
              label="Mensagens do bot (50d)"
              value={intFmt(data.kpis.botMessages.value)}
              kpi={data.kpis.botMessages}
              hint="Respostas do agente · janela 50 dias"
            />
            <KpiCard
              icon={RefreshCw}
              label="Taxa de resposta"
              value={pctFmt(data.kpis.responseRate.value)}
              kpi={data.kpis.responseRate}
              hint="Clientes que responderam o bot"
            />
            <KpiCard
              icon={Target}
              label="Taxa de conversão"
              value={pctFmt(data.kpis.conversionRate.value)}
              kpi={data.kpis.conversionRate}
              hint="Da 1ª msg até o agendamento"
            />
            <KpiCard
              icon={Clock}
              label="Em andamento"
              value={intFmt(data.kpis.inProgress.value)}
              kpi={data.kpis.inProgress}
              hint="Conversas abertas sem conversão"
            />
            <KpiCard
              icon={Inbox}
              label="Não completadas"
              value={intFmt(data.kpis.notCompleted.value)}
              kpi={data.kpis.notCompleted}
              hint="Iniciadas e abandonadas"
            />
          </div>

          {/* Linha + Donut */}
          <div className="mb-[18px] grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-[18px] max-[980px]:grid-cols-1">
            <Card className="anim-fade-up gap-0 p-[22px_24px]">
              <div className="mb-[18px] flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold tracking-[-0.01em]">
                    Volume de mensagens
                  </div>
                  <div className="mt-[3px] text-[13px] text-muted-foreground">
                    Bot × cliente por dia · últimos {RANGE_DAYS_LABEL[range]}{" "}
                    dias
                  </div>
                </div>
                <Legend />
              </div>
              <LineChart data={data.line} height={250} />
            </Card>

            <Card className="anim-fade-up gap-0 p-[22px_24px]">
              <div className="mb-1 text-base font-semibold tracking-[-0.01em]">
                Status das conversas
              </div>
              <div className="mb-[22px] text-[13px] text-muted-foreground">
                Distribuição atual
              </div>
              <div className="flex justify-center">
                <Donut data={data.statusDistribution} />
              </div>
            </Card>
          </div>

          {/* Funil + Top tags */}
          <div className="mb-[18px] grid grid-cols-2 gap-[18px] max-[980px]:grid-cols-1">
            <Card className="anim-fade-up gap-0 p-[22px_24px]">
              <div className="mb-1 text-base font-semibold tracking-[-0.01em]">
                Funil de conversão
              </div>
              <div className="mb-[22px] text-[13px] text-muted-foreground">
                Iniciadas → engajadas → agendadas
              </div>
              <Funnel data={data.funnel} />
              <BookingsFootnote bookings={data.bookings} />
            </Card>
            <Card className="anim-fade-up gap-0 p-[22px_24px]">
              <div className="mb-1 text-base font-semibold tracking-[-0.01em]">
                Tags mais frequentes
              </div>
              <div className="mb-[22px] text-[13px] text-muted-foreground">
                Interesses detectados nas conversas
              </div>
              {data.topTags.length > 0 ? (
                <HBars data={data.topTags} />
              ) : (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  Nenhuma tag detectada ainda.
                </p>
              )}
            </Card>
          </div>

          {/* Abandono × recorrência — perdas × clientes que voltaram a agendar */}
          <div className="mb-[18px]">
            <RetentionSection
              retention={data.retention}
              rangeDaysLabel={RANGE_DAYS_LABEL[range]}
            />
          </div>

          {/* Temperatura dos leads — clique abre o painel de detalhe */}
          <div className="mb-[18px]">
            <LeadTemperatureSection
              leads={leadsData?.leads}
              isLoading={leadsLoading}
              onLeadClick={(lead) => setSelectedLeadId(lead.id)}
            />
          </div>
          <LeadDetailDialog
            leadId={selectedLeadId}
            onOpenChange={(open) => {
              if (!open) setSelectedLeadId(null);
            }}
          />

          {/* Conversas recentes */}
          <Card className="anim-fade-up gap-0 overflow-hidden p-0">
            <div className="flex items-start justify-between gap-3 p-[22px_24px] pb-4">
              <div>
                <div className="text-base font-semibold tracking-[-0.01em]">
                  Conversas recentes
                </div>
                <div className="mt-[3px] text-[13px] text-muted-foreground">
                  Últimas interações do agente
                </div>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/leads">
                  Ver todas <ChevronRight className="size-4" />
                </Link>
              </Button>
            </div>
            <div className="overflow-x-auto">
              {recent && recent.length > 0 ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Procedimento</th>
                      <th>Tags</th>
                      <th>Status</th>
                      <th className="text-right">Atualizada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((c) => (
                      <tr
                        key={c.id}
                        className="cursor-pointer"
                        role="button"
                        tabIndex={0}
                        aria-haspopup="dialog"
                        onClick={() => setSelectedConversationId(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedConversationId(c.id);
                          }
                        }}
                      >
                        <td>
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-8">
                              <AvatarFallback className="bg-secondary text-[12px] font-semibold text-muted-foreground">
                                {initials(c.leadName, "P")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">
                              {c.leadName ?? "Cliente"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="text-muted-foreground">
                            {c.procedure ?? "—"}
                          </span>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1.5">
                            {c.tags.map((t) => (
                              <Tag key={t.name} name={t.name} color={t.color} />
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-col items-start gap-1.5">
                            <StatusBadge status={c.status} />
                            {c.handoffAt && <HandoffBadge active />}
                          </div>
                        </td>
                        <td className="text-right">
                          <span className="tabular text-muted-foreground">
                            {timeAgo(c.lastMessageAt)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                  Nenhuma conversa ainda. Inicie uma no{" "}
                  <Link href="/chat" className="font-medium text-primary">
                    chat
                  </Link>
                  .
                </p>
              )}
            </div>
          </Card>
          <ConversationDetailDialog
            conversationId={selectedConversationId}
            onOpenChange={(open) => {
              if (!open) setSelectedConversationId(null);
            }}
          />
        </>
      )}
    </>
  );
}

/** Legenda do gráfico de linha (Bot · Cliente). */
function Legend() {
  return (
    <div className="flex gap-4">
      {[
        { c: "var(--chart-1)", l: "Bot" },
        { c: "var(--chart-3)", l: "Cliente" },
      ].map((it) => (
        <span
          key={it.l}
          className="flex items-center gap-[7px] text-[13px] text-muted-foreground"
        >
          <span
            className="size-2.5 rounded-[3px]"
            style={{ background: it.c }}
          />
          {it.l}
        </span>
      ))}
    </div>
  );
}

/** Skeleton enquanto as métricas carregam. */
function DashboardSkeleton() {
  return (
    <>
      <div className="mb-[18px] grid grid-cols-3 gap-[18px] max-[1100px]:grid-cols-2 max-[680px]:grid-cols-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[150px] w-full" />
        ))}
      </div>
      <div className="mb-[18px] grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-[18px] max-[980px]:grid-cols-1">
        <Skeleton className="h-[320px] w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
      <div className="mb-[18px] grid grid-cols-2 gap-[18px] max-[980px]:grid-cols-1">
        <Skeleton className="h-[220px] w-full" />
        <Skeleton className="h-[220px] w-full" />
      </div>
      <Skeleton className="mb-[18px] h-[360px] w-full" />
      <Skeleton className="mb-[18px] h-[240px] w-full" />
      <Skeleton className="h-[280px] w-full" />
    </>
  );
}
