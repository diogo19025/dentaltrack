"use client";

import { useRef, useMemo, useState } from "react";
import type { LeadDto, LeadImportResult } from "@dentaltrack/shared";
import {
  Calendar,
  Clock,
  Download,
  Filter,
  Inbox,
  Loader2,
  MoreHorizontal,
  Phone,
  Search,
  Upload,
  Users,
} from "lucide-react";
import { LeadDetailDialog } from "@/components/dashboard/lead-detail-dialog";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tag } from "@/components/ui/tag";
import { useImportLeads, useLeads } from "@/hooks/use-leads";
import { apiDownload, ApiError } from "@/lib/api-client";
import { formatCaptured, initials, sourceLabel } from "@/lib/format";
import { OwnerOnly } from "@/components/auth/role-context";

/**
 * Leads (FE-3.6) — réplica 1:1 de `screen_leads.jsx`: 4 cards-resumo + tabela
 * com busca, filtro de status (segmented) e paginação. Dados reais via TanStack
 * Query (GET /leads). F8: "Exportar" (CSV no cliente · Excel/PDF pelo backend)
 * e "Importar" (planilha .xlsx/.csv → POST /leads/import + dialog de resultado).
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [failedExport, setFailedExport] = useState<"xlsx" | "pdf">("xlsx");
  const [importResult, setImportResult] = useState<LeadImportResult | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importLeads = useImportLeads();

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const summary = data?.summary ?? {
    total: 0,
    agendada: 0,
    andamento: 0,
    abandonada: 0,
  };

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
  const pageItems = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  function onFilter(value: StatusFilter) {
    setFilter(value);
    setPage(0);
  }
  function onSearch(value: string) {
    setQuery(value);
    setPage(0);
  }

  async function onExport(format: "xlsx" | "pdf") {
    setExportError(null);
    setFailedExport(format);
    setExporting(true);
    try {
      await apiDownload(`/leads/export?format=${format}`);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  }

  function onImportFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    importLeads.mutate(file, {
      onSuccess: (result) => setImportResult(result),
      onError: (error) => setImportError(importErrorMessage(error)),
    });
  }

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Clientes em potencial capturados pelo agente nas conversas."
      >
        <OwnerOnly>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="sr-only"
            aria-label="Planilha de leads (.xlsx ou .csv)"
            onChange={(e) => {
              onImportFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            disabled={importLeads.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {importLeads.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}{" "}
            Importar
          </Button>
        </OwnerOnly>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              disabled={exporting || filtered.length === 0}
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}{" "}
              Exportar
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => exportCsv(filtered)}>
              CSV (leads filtrados)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void onExport("xlsx")}>
              Excel (.xlsx)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void onExport("pdf")}>
              PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      {exportError !== null && (
        <ErrorState
          compact
          className="mb-5"
          error={exportError}
          title="Não foi possível exportar os leads"
          onRetry={() => void onExport(failedExport)}
        />
      )}

      {/* Cards-resumo */}
      <div className="stagger mb-5 grid grid-cols-4 gap-[18px] max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
        <SummaryCard
          icon={Users}
          label="Total de leads"
          value={summary.total}
          color="var(--primary)"
          loading={isLoading}
        />
        <SummaryCard
          icon={Calendar}
          label="Agendados"
          value={summary.agendada}
          color="var(--status-agendada)"
          loading={isLoading}
        />
        <SummaryCard
          icon={Clock}
          label="Em andamento"
          value={summary.andamento}
          color="var(--status-andamento)"
          loading={isLoading}
        />
        <SummaryCard
          icon={Inbox}
          label="Não completados"
          value={summary.abandonada}
          color="var(--status-abandonada)"
          loading={isLoading}
        />
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
          <Segmented
            aria-label="Filtrar por status"
            options={STATUS_FILTERS}
            value={filter}
            onChange={onFilter}
          />
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
                      <span className="text-muted-foreground">
                        {l.interest ?? "—"}
                      </span>
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
              Mostrando{" "}
              <strong className="text-foreground">{filtered.length}</strong> de{" "}
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

      {/* Resultado (ou erro) da importação de planilha (F8). */}
      <Dialog
        open={importResult !== null || importError !== null}
        onOpenChange={(open) => {
          if (!open) {
            setImportResult(null);
            setImportError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {importError ? "Falha na importação" : "Importação concluída"}
            </DialogTitle>
            <DialogDescription>
              {importError
                ? importError
                : importResult
                  ? `${importResult.imported} de ${importResult.total} linha(s) viraram leads.`
                  : null}
            </DialogDescription>
          </DialogHeader>
          {importResult && (
            <div className="space-y-3 text-sm">
              <ul className="space-y-1 text-muted-foreground">
                <li>
                  <strong className="text-foreground">
                    {importResult.imported}
                  </strong>{" "}
                  importado(s)
                </li>
                <li>
                  <strong className="text-foreground">
                    {importResult.duplicates}
                  </strong>{" "}
                  pulado(s) por já existirem (mesmo telefone ou e-mail)
                </li>
                <li>
                  <strong className="text-foreground">
                    {importResult.invalid}
                  </strong>{" "}
                  inválido(s)
                </li>
              </ul>
              {importResult.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/40 p-3">
                  <ul className="space-y-1 text-[13px] text-muted-foreground">
                    {importResult.errors.map((err) => (
                      <li key={`${err.line}-${err.reason}`}>
                        Linha {err.line}: {err.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {importError && (
            <p className="text-sm text-muted-foreground">
              A planilha precisa de um cabeçalho na 1ª linha com colunas
              &quot;Nome&quot;, &quot;Telefone&quot; e/ou &quot;E-mail&quot;
              (.xlsx ou .csv).
            </p>
          )}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setImportResult(null);
                setImportError(null);
              }}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Mensagem amigável do erro de importação (extrai o `message` do NestJS). */
function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.message) as { message?: string | string[] };
      const message = Array.isArray(body.message)
        ? body.message[0]
        : body.message;
      if (message) return message;
    } catch {
      // corpo não-JSON → usa o texto cru abaixo
    }
    return error.message || "Não foi possível importar a planilha.";
  }
  return "Não foi possível importar a planilha.";
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
          <div className="tabular text-[24px] font-semibold leading-none">
            {value}
          </div>
        )}
        <div className="mt-1 text-[12.5px] text-muted-foreground">{label}</div>
      </div>
    </Card>
  );
}

/** Gera e baixa um CSV dos leads filtrados (client-side). */
function exportCsv(leads: LeadDto[]): void {
  const header = [
    "Nome",
    "Telefone",
    "E-mail",
    "Interesse",
    "Tags",
    "Status",
    "Origem",
    "Capturado",
  ];
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
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = [header, ...rows]
    .map((r) => r.map((c) => escape(String(c))).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads.csv";
  a.click();
  URL.revokeObjectURL(url);
}
