"use client";

import { useMemo, useState } from "react";
import type { LeadDto } from "@dentaltrack/shared";
import { Calendar, Clock, Download, Filter, Inbox, MoreHorizontal, Phone, Search, Users } from "lucide-react";
import { LeadDetailDialog } from "@/components/dashboard/lead-detail-dialog";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tag } from "@/components/ui/tag";
import { useLeads } from "@/hooks/use-leads";
import { formatCaptured, initials, sourceLabel } from "@/lib/format";

/**
 * Leads (FE-3.6) — réplica 1:1 de `screen_leads.jsx`: 4 cards-resumo + tabela
 * com busca, filtro de status (segmented) e paginação. Dados reais via TanStack
 * Query (GET /leads). "Exportar CSV" gera o arquivo no cliente.
 */

const STATUS_FILTERS = [
  { value: "todos", label: "Todos" },
  { value: "agendada", label: "Agendados" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "abandonada", label: "Não compl." },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

const PAGE_SIZE = 8;

export default function LeadsPage() {
  const { data, isLoading } = useLeads();
  const [filter, setFilter] = useState<StatusFilter>("todos");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const summary = data?.summary ?? { total: 0, agendada: 0, andamento: 0, abandonada: 0 };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      if (filter !== "todos" && l.status !== filter) return false;
      if (!q) return true;
      const hay = [l.name, l.phone, l.interest, ...l.tags.map((t) => t.name)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [leads, filter, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function onFilter(value: StatusFilter) {
    setFilter(value);
    setPage(0);
  }
  function onSearch(value: string) {
    setQuery(value);
    setPage(0);
  }

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Pacientes em potencial capturados pelo agente nas conversas."
      >
        <Button variant="secondary" onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
          <Download className="size-4" /> Exportar CSV
        </Button>
      </PageHeader>

      {/* Cards-resumo */}
      <div className="stagger mb-5 grid grid-cols-4 gap-[18px] max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
        <SummaryCard icon={Users} label="Total de leads" value={summary.total} color="var(--primary)" loading={isLoading} />
        <SummaryCard icon={Calendar} label="Agendados" value={summary.agendada} color="var(--status-agendada)" loading={isLoading} />
        <SummaryCard icon={Clock} label="Em andamento" value={summary.andamento} color="var(--status-andamento)" loading={isLoading} />
        <SummaryCard icon={Inbox} label="Não completados" value={summary.abandonada} color="var(--status-abandonada)" loading={isLoading} />
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-[18px] py-4">
          <div className="relative min-w-[220px] max-w-[340px] flex-1">
            <Search className="pointer-events-none absolute left-[13px] top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar por nome, telefone ou tag…"
              className="pl-10"
            />
          </div>
          <div className="flex-1" />
          <Segmented aria-label="Filtrar por status" options={STATUS_FILTERS} value={filter} onChange={onFilter} />
          <Button variant="secondary" size="icon-sm" aria-label="Filtros">
            <Filter className="size-4" />
          </Button>
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="space-y-3 p-[18px]">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : pageItems.length === 0 ? (
            <p className="px-6 py-14 text-center text-sm text-muted-foreground">
              {leads.length === 0
                ? "Nenhum lead capturado ainda. Eles aparecem aqui quando o agente registra um contato."
                : "Nenhum lead corresponde aos filtros."}
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Contato</th>
                  <th>Interesse</th>
                  <th>Tags</th>
                  <th>Status</th>
                  <th>Origem</th>
                  <th className="text-right">Capturado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageItems.map((l) => (
                  <tr
                    key={l.id}
                    className="cursor-pointer"
                    role="button"
                    tabIndex={0}
                    aria-haspopup="dialog"
                    onClick={() => setSelectedLeadId(l.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedLeadId(l.id);
                      }
                    }}
                  >
                    <td>
                      <div className="flex items-center gap-[11px]">
                        <Avatar className="size-[34px]">
                          <AvatarFallback className="bg-primary-tint text-[13px] font-semibold text-primary">
                            {initials(l.name, "L")}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{l.name ?? "Lead"}</span>
                      </div>
                    </td>
                    <td>
                      <span className="tabular flex items-center gap-[7px] text-muted-foreground">
                        <Phone className="size-3.5" />
                        {l.phone ?? "—"}
                      </span>
                    </td>
                    <td>
                      <span className="text-muted-foreground">{l.interest ?? "—"}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {l.tags.map((t) => (
                          <Tag key={t.name} name={t.name} color={t.color} />
                        ))}
                      </div>
                    </td>
                    <td>
                      {l.status ? (
                        <StatusBadge status={l.status} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td>
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-[5px] text-[12px] font-medium text-muted-foreground">
                        {sourceLabel(l.source)}
                      </span>
                    </td>
                    <td className="text-right">
                      <span className="tabular whitespace-nowrap text-muted-foreground">
                        {formatCaptured(l.createdAt)}
                      </span>
                    </td>
                    <td className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Ações"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer / paginação */}
        {!isLoading && filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-[18px] py-3.5">
            <span className="text-[13px] text-muted-foreground">
              Mostrando <strong className="text-foreground">{filtered.length}</strong> de{" "}
              {leads.length} leads
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Próximo
              </Button>
            </div>
          </div>
        )}
      </Card>

      <LeadDetailDialog
        leadId={selectedLeadId}
        onOpenChange={(open) => {
          if (!open) setSelectedLeadId(null);
        }}
      />
    </>
  );
}

/** Card de resumo (ícone em quadrado secondary + número + label). */
function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
  loading,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  color: string;
  loading: boolean;
}) {
  return (
    <Card className="lift flex flex-row items-center gap-3.5 p-[22px_24px]">
      <span
        className="flex size-[42px] flex-none items-center justify-center rounded-[11px] bg-secondary"
        style={{ color }}
      >
        <Icon className="size-5" />
      </span>
      <div>
        {loading ? (
          <Skeleton className="h-6 w-10" />
        ) : (
          <div className="tabular text-[24px] font-semibold leading-none">{value}</div>
        )}
        <div className="mt-1 text-[12.5px] text-muted-foreground">{label}</div>
      </div>
    </Card>
  );
}

/** Gera e baixa um CSV dos leads filtrados (client-side). */
function exportCsv(leads: LeadDto[]): void {
  const header = ["Nome", "Telefone", "E-mail", "Interesse", "Tags", "Status", "Origem", "Capturado"];
  const rows = leads.map((l) => [
    l.name ?? "",
    l.phone ?? "",
    l.email ?? "",
    l.interest ?? "",
    l.tags.map((t) => t.name).join("; "),
    l.status ?? "",
    l.source,
    l.createdAt,
  ]);
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [header, ...rows].map((r) => r.map((c) => escape(String(c))).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads.csv";
  a.click();
  URL.revokeObjectURL(url);
}
