"use client";

import { useMemo, useState } from "react";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_LABELS,
  type AppointmentStatus,
  type AppointmentSummary,
  type ProfessionalDto,
} from "@dentaltrack/shared";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Link2,
  PlugZap,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";
import { AppointmentBadge } from "@/components/agenda/appointment-badge";
import { AppointmentDetailDialog } from "@/components/agenda/appointment-detail-dialog";
import { ScheduledMessagesCard } from "@/components/agenda/scheduled-messages";
import {
  DAY_MS,
  appointmentRange,
  dateKey,
  dateKeyPlus,
  formatHm,
  formatWhen,
  pad2,
  startOfDay,
} from "@/components/agenda/format";
import {
  professionalColor,
  professionalResolver,
} from "@/components/agenda/professional-color";
import { useAgenda, useSyncAgenda } from "@/hooks/use-agenda";
import { useAutomationHistory } from "@/hooks/use-automations";
import { useIntegration } from "@/hooks/use-integration";
import { useProfessionals } from "@/hooks/use-professionals";
import { cn } from "@/lib/utils";
import { OwnerOnly, useRole } from "@/components/auth/role-context";

/** Altura de uma hora na grade, em px. */
const HOUR_PX = 56;
const DAYS_IN_GRID = 7;
const UPCOMING_LIMIT = 4;
/** Quantos profissionais a legenda mostra antes de resumir em "+N". */
const LEGEND_LIMIT = 6;

/** Cor de um agendamento — sempre a do profissional que atende. */
type ColorOf = (appointment: AppointmentSummary) => string;

/**
 * /agenda (F9) — o que está marcado e o que o sistema mandou.
 *
 * Duas vistas complementares: os **próximos agendamentos** (o que vem aí, em
 * cards) e a **grade da semana** ao estilo Google Agenda — atendimentos
 * marcados como blocos sólidos, coloridos **pelo profissional** que atende,
 * o mesmo dado que o assistente oferece aos clientes. Clicar num bloco ou num
 * card abre o painel do agendamento (detalhes, WhatsApp, lembrete, remarcar,
 * cancelar). Abaixo, o histórico das mensagens automáticas — o que saiu e o
 * que foi suprimido, com o motivo.
 *
 * Fora do handoff de design; segue o design system existente (produto.md § Design).
 */
export default function AgendaPage() {
  const { isOwner } = useRole();
  // Início da semana exibida (meia-noite local). 0 = semana que começa hoje.
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => {
    const today = startOfDay(new Date());
    return new Date(today.getTime() + weekOffset * DAYS_IN_GRID * DAY_MS);
  }, [weekOffset]);
  const weekEnd = useMemo(
    () => new Date(weekStart.getTime() + (DAYS_IN_GRID - 1) * DAY_MS),
    [weekStart],
  );

  const { data: weekData, isLoading: weekLoading } = useAgenda(
    dateKey(weekStart),
    dateKey(weekEnd),
  );
  // Janela larga só para a lista de próximos — independe da semana exibida.
  const { data: upcomingData } = useAgenda(
    dateKey(new Date()),
    dateKeyPlus(30),
  );

  const { data: clinicorpIntegration } = useIntegration("clinicorp", isOwner);
  const { data: googleIntegration } = useIntegration(
    "google",
    isOwner && clinicorpIntegration?.activeProvider === "google",
  );
  const integration =
    clinicorpIntegration?.activeProvider === "google"
      ? googleIntegration
      : clinicorpIntegration;
  const { data: history = [] } = useAutomationHistory(50, isOwner);
  const sync = useSyncAgenda();

  // Equipe (F20), inativos inclusos: o histórico aponta para quem já saiu, e
  // ele precisa continuar filtrável e com a mesma cor de sempre.
  const { data: professionals = [] } = useProfessionals(true);
  const activeProfessionals = useMemo(
    () => professionals.filter((p) => p.active),
    [professionals],
  );
  const professionalOf = useMemo(
    () => professionalResolver(professionals),
    [professionals],
  );
  const colorOf = useMemo<ColorOf>(
    () => (a) => professionalColor(professionalOf(a), professionals),
    [professionalOf, professionals],
  );

  // Busca + filtros (situação, profissional, procedimento, cliente) — valem
  // para a grade e para a lista de próximos, como num calendário de verdade.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "todos">(
    "todos",
  );
  const [procedureFilter, setProcedureFilter] = useState("todos");
  const [clientFilter, setClientFilter] = useState("todos");
  const [professionalFilter, setProfessionalFilter] = useState("todos");
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (a: AppointmentSummary) => {
      if (statusFilter !== "todos" && a.status !== statusFilter) return false;
      if (
        professionalFilter !== "todos" &&
        professionalOf(a)?.id !== professionalFilter
      ) {
        return false;
      }
      if (procedureFilter !== "todos" && a.procedureName !== procedureFilter) {
        return false;
      }
      if (clientFilter !== "todos" && a.leadName !== clientFilter) return false;
      if (!term) return true;
      return [a.leadName, a.leadPhone, a.procedureName, a.professionalName]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(term));
    };
  }, [
    search,
    statusFilter,
    procedureFilter,
    clientFilter,
    professionalFilter,
    professionalOf,
  ]);

  // Opções dos filtros, tiradas do que existe de fato nas janelas carregadas.
  const { procedureOptions, clientOptions } = useMemo(() => {
    const all = [
      ...(weekData?.appointments ?? []),
      ...(upcomingData?.appointments ?? []),
    ];
    const procedures = new Set<string>();
    const clients = new Set<string>();
    for (const a of all) {
      if (a.procedureName) procedures.add(a.procedureName);
      if (a.leadName) clients.add(a.leadName);
    }
    const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    return { procedureOptions: sort(procedures), clientOptions: sort(clients) };
  }, [weekData, upcomingData]);

  const hasActiveFilters =
    search !== "" ||
    statusFilter !== "todos" ||
    procedureFilter !== "todos" ||
    clientFilter !== "todos" ||
    professionalFilter !== "todos";

  const upcoming = useMemo(
    () => pickUpcoming((upcomingData?.appointments ?? []).filter(matches)),
    [upcomingData, matches],
  );
  const weekAppointments = useMemo(
    () => (weekData?.appointments ?? []).filter(matches),
    [weekData, matches],
  );

  // Agendamento aberto no painel de detalhe. Guardamos o objeto (não só o id)
  // para o painel abrir na hora, sem esperar rede; o próprio painel dispara as
  // mutações que invalidam a agenda.
  const [selected, setSelected] = useState<AppointmentSummary | null>(null);

  // Barra de busca e filtros — vive dentro do cartão da grade, como a barra
  // de um calendário, e vale também para a lista de próximos.
  const toolbar = (
    <div
      role="search"
      aria-label="Filtros da agenda"
      className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente ou procedimento"
          className="h-9 w-[240px] bg-card pl-8"
          aria-label="Buscar na agenda"
        />
      </div>
      <Select
        value={statusFilter}
        onValueChange={(value) =>
          setStatusFilter(value as AppointmentStatus | "todos")
        }
      >
        <SelectTrigger
          className="h-9 w-[170px]"
          aria-label="Filtrar por situação"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todas as situações</SelectItem>
          {APPOINTMENT_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {APPOINTMENT_STATUS_LABELS[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {professionals.length > 0 && (
        <Select
          value={professionalFilter}
          onValueChange={setProfessionalFilter}
        >
          <SelectTrigger
            className="h-9 w-[200px]"
            aria-label="Filtrar por profissional"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os profissionais</SelectItem>
            {professionals.map((professional) => (
              <SelectItem key={professional.id} value={professional.id}>
                <span className="flex items-center gap-2">
                  <ColorDot
                    color={professionalColor(professional, professionals)}
                  />
                  {professional.name}
                  {!professional.active && (
                    <span className="text-muted-foreground">(inativo)</span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {procedureOptions.length > 0 && (
        <Select value={procedureFilter} onValueChange={setProcedureFilter}>
          <SelectTrigger
            className="h-9 w-[190px]"
            aria-label="Filtrar por procedimento"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os procedimentos</SelectItem>
            {procedureOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {clientOptions.length > 0 && (
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger
            className="h-9 w-[170px]"
            aria-label="Filtrar por cliente"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os clientes</SelectItem>
            {clientOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {hasActiveFilters && (
        <Button
          type="button"
          variant="ghost"
          className="h-9"
          onClick={() => {
            setSearch("");
            setStatusFilter("todos");
            setProcedureFilter("todos");
            setClientFilter("todos");
            setProfessionalFilter("todos");
          }}
        >
          Limpar filtros
        </Button>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle="Os horários marcados e as mensagens que o assistente enviou sozinho."
      >
        {isOwner && integration && integration.mode !== "desligado" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            <RefreshCw
              className={cn("size-4", sync.isPending && "animate-spin")}
            />
            {sync.isPending ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        )}
      </PageHeader>

      <OwnerOnly>
        <IntegrationStrip
          mode={integration?.mode ?? "desligado"}
          lastSyncedAt={weekData?.lastSyncedAt ?? null}
        />
      </OwnerOnly>

      <UpcomingSection
        appointments={upcoming}
        loading={weekLoading}
        colorOf={colorOf}
        onSelect={setSelected}
      />

      <WeekGrid
        weekStart={weekStart}
        appointments={weekAppointments}
        loading={weekLoading}
        colorOf={colorOf}
        legend={activeProfessionals.length > 1 ? activeProfessionals : []}
        allProfessionals={professionals}
        toolbar={toolbar}
        onSelect={setSelected}
        onPrev={() => setWeekOffset((v) => v - 1)}
        onNext={() => setWeekOffset((v) => v + 1)}
        onToday={() => setWeekOffset(0)}
        isCurrentWeek={weekOffset === 0}
      />

      <OwnerOnly>
        <ScheduledMessagesCard history={history} />
      </OwnerOnly>

      <AppointmentDetailDialog
        appointment={selected}
        color={selected ? colorOf(selected) : "var(--primary)"}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}

/* ─────────────────────────── Próximos agendamentos ─────────────────────────── */

function UpcomingSection({
  appointments,
  loading,
  colorOf,
  onSelect,
}: {
  appointments: AppointmentSummary[];
  loading: boolean;
  colorOf: ColorOf;
  onSelect: (appointment: AppointmentSummary) => void;
}) {
  return (
    <section className="mb-5">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 className="text-base font-semibold tracking-[-0.01em]">
          Próximos agendamentos
        </h2>
        <span className="text-xs text-muted-foreground">próximos 30 dias</span>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: UPCOMING_LIMIT }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-lg" />
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <Card className="p-0">
          <Empty
            icon={<CalendarClock className="size-5" />}
            title="Nada marcado por enquanto"
            desc="Assim que o assistente (ou a equipe) marcar um horário, ele aparece aqui."
          />
        </Card>
      ) : (
        <ul role="list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {appointments.map((appointment) => {
            const color = colorOf(appointment);
            return (
              <li key={appointment.id} className="min-w-0">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => onSelect(appointment)}
                  className={cn(
                    "relative flex w-full flex-col gap-1.5 overflow-hidden rounded-lg border border-border bg-card p-4 pl-5 text-left shadow-sm outline-none",
                    "transition-[box-shadow,border-color,scale] duration-150 ease-out",
                    "hover:border-border-strong hover:shadow-[var(--shadow-md)]",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    "active:scale-[0.992]",
                  )}
                >
                  {/* Filete do profissional — a mesma cor do bloco na grade. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-3 left-0 w-[3px] rounded-r-full"
                    style={{ background: color }}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular text-[13px] font-semibold text-primary">
                      {appointment.startsAt
                        ? formatWhen(appointment.startsAt)
                        : (appointment.preferredTime ?? "A combinar")}
                    </span>
                    <AppointmentBadge status={appointment.status} />
                  </div>
                  <div className="truncate text-sm font-medium">
                    {appointment.leadName ?? "Sem nome"}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
                    <span className="truncate font-medium">
                      {appointment.procedureName ?? "Consulta"}
                    </span>
                    {appointment.professionalName && (
                      <span className="truncate text-muted-foreground">
                        · {appointment.professionalName}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ─────────────────────────── Grade da semana ─────────────────────────── */

interface AppointmentBlock {
  top: number;
  height: number;
  startsAt: Date;
  endsAt: Date;
  appointment: AppointmentSummary;
  /** Faixa ocupada dentro do dia quando há horários coincidentes. */
  lane: number;
  lanes: number;
}

function WeekGrid({
  weekStart,
  appointments,
  loading,
  colorOf,
  legend,
  allProfessionals,
  toolbar,
  onSelect,
  onPrev,
  onNext,
  onToday,
  isCurrentWeek,
}: {
  weekStart: Date;
  appointments: AppointmentSummary[];
  loading: boolean;
  colorOf: ColorOf;
  /** Profissionais da legenda (vazio = sem legenda, equipe de um só). */
  legend: ProfessionalDto[];
  allProfessionals: ProfessionalDto[];
  /** Busca e filtros, renderizados como a segunda linha do cabeçalho. */
  toolbar: React.ReactNode;
  onSelect: (appointment: AppointmentSummary) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isCurrentWeek: boolean;
}) {
  const days = useMemo(
    () =>
      Array.from(
        { length: DAYS_IN_GRID },
        (_, i) => new Date(weekStart.getTime() + i * DAY_MS),
      ),
    [weekStart],
  );

  // Janela de horas da grade: 8–18 por padrão, esticada pelo que existir fora.
  const timed = appointments.filter(
    (a) => a.startsAt && a.status !== "cancelado",
  );
  const { hourStart, hourEnd } = useMemo(() => {
    let start = 8;
    let end = 18;
    for (const a of timed) {
      const range = appointmentRange(a);
      if (!range) continue;
      const { startsAt: s, endsAt: e } = range;
      start = Math.min(start, s.getHours());
      end = Math.max(end, e.getMinutes() > 0 ? e.getHours() + 1 : e.getHours());
    }
    return { hourStart: start, hourEnd: Math.max(end, start + 1) };
  }, [timed]);

  const bodyHeight = (hourEnd - hourStart) * HOUR_PX;
  const hours = Array.from(
    { length: hourEnd - hourStart },
    (_, i) => hourStart + i,
  );

  const today = startOfDay(new Date()).getTime();
  const now = new Date();
  const nowTop = (now.getHours() - hourStart + now.getMinutes() / 60) * HOUR_PX;

  return (
    <Card className="mb-5 gap-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-base font-semibold tracking-[-0.01em]">
            Grade da semana
          </h2>
          <span className="tabular text-[13px] text-muted-foreground first-letter:uppercase">
            {rangeLabel(days[0], days[days.length - 1])}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {legend.length > 0 && (
            <Legend professionals={legend} all={allProfessionals} />
          )}
          {/* Navegação como um grupo só: uma borda, divisórias entre os botões. */}
          <div
            role="group"
            aria-label="Navegar entre semanas"
            className="flex h-[34px] items-stretch overflow-hidden rounded-[var(--radius-sm)] border border-border-strong bg-card shadow-xs [&>*+*]:border-l [&>*+*]:border-border"
          >
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-[34px] rounded-none px-0"
              aria-label="Semana anterior"
              onClick={onPrev}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-auto rounded-none px-3 text-[13px]"
              onClick={onToday}
              disabled={isCurrentWeek}
            >
              Hoje
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-[34px] rounded-none px-0"
              aria-label="Próxima semana"
              onClick={onNext}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {toolbar}

      {loading ? (
        <div className="p-6">
          <Skeleton className="h-72 w-full rounded-[var(--radius-sm)]" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Cabeçalho dos dias */}
            <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))] border-b border-border">
              <div />
              {days.map((day) => {
                const isToday = day.getTime() === today;
                return (
                  <div
                    key={day.toISOString()}
                    className="border-l border-border px-2 py-2 text-center"
                  >
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {day.toLocaleDateString("pt-BR", { weekday: "short" })}
                    </div>
                    <div
                      className={cn(
                        "mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                        isToday && "bg-primary text-primary-foreground",
                      )}
                    >
                      {day.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Corpo: gutter de horas + 7 colunas */}
            <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))]">
              <div className="relative" style={{ height: bodyHeight }}>
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="tabular absolute right-1.5 -translate-y-1/2 text-[11px] text-muted-foreground"
                    style={{ top: (hour - hourStart) * HOUR_PX }}
                  >
                    {hour > hourStart ? `${pad2(hour)}:00` : ""}
                  </div>
                ))}
              </div>

              {days.map((day) => {
                const isToday = day.getTime() === today;
                const blocks = appointmentBlocksFor(day, timed, hourStart);
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "relative border-l border-border",
                      isToday && "bg-primary-tint/40",
                    )}
                    style={{ height: bodyHeight }}
                  >
                    {hours.map((hour) => (
                      <div
                        key={hour}
                        className="absolute inset-x-0 border-t border-border/60"
                        style={{ top: (hour - hourStart) * HOUR_PX }}
                      />
                    ))}

                    {blocks.map(
                      ({
                        appointment,
                        top,
                        height,
                        startsAt,
                        endsAt,
                        lane,
                        lanes,
                      }) => {
                        const missed = appointment.status === "faltou";
                        const range = `${formatHm(startsAt)} – ${formatHm(endsAt)}`;
                        const color = missed
                          ? "var(--status-abandonada)"
                          : colorOf(appointment);
                        const name = appointment.leadName ?? "Sem nome";
                        const label = `${range} · ${name}${appointment.procedureName ? ` · ${appointment.procedureName}` : ""}${appointment.professionalName ? ` · ${appointment.professionalName}` : ""} (${APPOINTMENT_STATUS_LABELS[appointment.status]})`;
                        return (
                          <button
                            key={appointment.id}
                            type="button"
                            aria-label={label}
                            aria-haspopup="dialog"
                            title={label}
                            onClick={() => onSelect(appointment)}
                            className={cn(
                              "absolute block overflow-hidden rounded-[6px] py-[3px] pl-2 pr-1.5 text-left outline-none",
                              "transition-[box-shadow,filter,scale] duration-150 ease-out",
                              "hover:z-10 hover:shadow-[var(--shadow-md)] hover:brightness-[0.97]",
                              "focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                              "active:scale-[0.985] active:brightness-[0.95] active:duration-0",
                              missed && "line-through decoration-current/50",
                            )}
                            style={{
                              ...blockStyle(color),
                              top,
                              height,
                              left: `calc(${(lane * 100) / lanes}% + 4px)`,
                              width: `calc(${100 / lanes}% - ${lane === lanes - 1 ? 8 : 5}px)`,
                            }}
                          >
                            {height >= 44 ? (
                              <>
                                <div className="truncate text-[12px] font-semibold leading-[1.25]">
                                  {name}
                                </div>
                                <div className="tabular truncate text-[11px] leading-[1.25] opacity-80">
                                  {range}
                                </div>
                                {height >= 62 && (
                                  <div className="truncate text-[11px] font-medium leading-[1.25] opacity-80">
                                    {appointment.procedureName ?? "Consulta"}
                                    {appointment.professionalName
                                      ? ` · ${appointment.professionalName}`
                                      : ""}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="flex items-baseline gap-1.5 truncate text-[12px] leading-[1.25]">
                                <span className="tabular flex-none font-medium opacity-80">
                                  {formatHm(startsAt)}
                                </span>
                                <span className="truncate font-semibold">
                                  {name}
                                </span>
                              </div>
                            )}
                          </button>
                        );
                      },
                    )}

                    {isToday && nowTop >= 0 && nowTop <= bodyHeight && (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-10"
                        style={{ top: nowTop }}
                      >
                        <div className="h-[2px] bg-destructive" />
                        <div className="absolute -left-[3px] -top-[3px] size-2 rounded-full bg-destructive" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Legenda de cores por profissional (só com equipe de 2+). */
function Legend({
  professionals,
  all,
}: {
  professionals: ProfessionalDto[];
  all: ProfessionalDto[];
}) {
  const shown = professionals.slice(0, LEGEND_LIMIT);
  const rest = professionals.length - shown.length;
  return (
    <ul
      aria-label="Legenda de profissionais"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground"
    >
      {shown.map((professional) => (
        <li key={professional.id} className="flex items-center gap-1.5">
          <ColorDot color={professionalColor(professional, all)} />
          {professional.name}
        </li>
      ))}
      {rest > 0 && <li>+{rest}</li>}
    </ul>
  );
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 flex-none rounded-full"
      style={{ background: color }}
    />
  );
}

/**
 * Estilo do bloco: fundo no tom claro da cor do profissional, texto na mesma
 * cor escurecida e a barra sólida à esquerda. Um bloco sólido com texto
 * branco a 10px não passava no contraste nas cores claras da paleta (dourado,
 * verde-sálvia), e uma semana cheia virava uma parede de chips escuros.
 */
function blockStyle(color: string): React.CSSProperties {
  return {
    "--pro": color,
    background: `color-mix(in srgb, ${color} 14%, var(--card))`,
    color: `color-mix(in srgb, ${color} 72%, black)`,
    boxShadow: `inset 3px 0 0 ${color}`,
  } as React.CSSProperties;
}

/** Blocos de atendimento do dia, posicionados na grade. */
function appointmentBlocksFor(
  day: Date,
  appointments: AppointmentSummary[],
  hourStart: number,
): AppointmentBlock[] {
  const dayStart = day.getTime();
  const dayEnd = dayStart + DAY_MS;
  const blocks = appointments
    .filter((a) => {
      const t = new Date(a.startsAt as string).getTime();
      return t >= dayStart && t < dayEnd;
    })
    .map((appointment) => {
      const { startsAt, endsAt } = appointmentRange(appointment) as {
        startsAt: Date;
        endsAt: Date;
      };
      return {
        appointment,
        startsAt,
        endsAt,
        top: minutesFrom(startsAt, hourStart) * (HOUR_PX / 60),
        height: Math.max(
          ((endsAt.getTime() - startsAt.getTime()) / 60_000) * (HOUR_PX / 60) -
            2,
          24,
        ),
        lane: 0,
        lanes: 1,
      };
    })
    .sort(
      (a, b) =>
        a.startsAt.getTime() - b.startsAt.getTime() ||
        b.endsAt.getTime() - a.endsAt.getTime(),
    );
  assignLanes(blocks);
  return blocks;
}

/**
 * Horários coincidentes ficam lado a lado, como num calendário de verdade —
 * com dez profissionais, dois às 09:00 no mesmo dia é o caso comum, e um
 * bloco por cima do outro escondia o de baixo. Agrupa os que se sobrepõem em
 * cadeia e dá a cada um a primeira faixa livre; a largura do grupo é dividida
 * pelo número de faixas que ele precisou.
 */
function assignLanes(blocks: AppointmentBlock[]): void {
  let group: AppointmentBlock[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    for (const b of group) b.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const block of blocks) {
    const start = block.startsAt.getTime();
    if (start >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = block.endsAt.getTime();
    block.lane = lane;
    group.push(block);
    groupEnd = Math.max(groupEnd, block.endsAt.getTime());
  }
  close();
}

/* ─────────────────────────── Blocos compartilhados ─────────────────────────── */

function IntegrationStrip({
  mode,
  lastSyncedAt,
}: {
  mode: string;
  lastSyncedAt: string | null;
}) {
  const connected = mode !== "desligado";
  return (
    <div
      className={cn(
        "mb-5 flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-border px-4 py-3 text-[13px]",
        connected ? "bg-primary-tint" : "bg-secondary",
      )}
    >
      {connected ? (
        <Link2
          className="size-4 flex-none"
          style={{ color: "var(--primary)" }}
        />
      ) : (
        <PlugZap className="size-4 flex-none text-muted-foreground" />
      )}
      <span
        className={connected ? "text-primary" : "text-secondary-foreground"}
      >
        {mode === "live"
          ? "Conectado ao sistema de gestão — o assistente oferece só horários livres de verdade."
          : mode === "mock"
            ? "Integração em modo simulado — os dados abaixo são fictícios, para conhecer o fluxo."
            : "Sem sistema de gestão conectado. O assistente coleta a preferência e a equipe confirma."}
      </span>
      {lastSyncedAt && (
        <span className="ml-auto text-xs text-muted-foreground">
          Sincronizado em {new Date(lastSyncedAt).toLocaleString("pt-BR")}
        </span>
      )}
    </div>
  );
}

function Empty({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <div className="text-sm font-semibold">{title}</div>
      <p className="max-w-[420px] text-[13px] text-muted-foreground">{desc}</p>
    </div>
  );
}

/* ─────────────────────────── Datas ─────────────────────────── */

/** Os próximos que ainda vão acontecer (ou pedidos sem horário), mais cedo primeiro. */
function pickUpcoming(
  appointments: AppointmentSummary[],
): AppointmentSummary[] {
  const now = Date.now();
  return appointments
    .filter(
      (a) =>
        a.status !== "cancelado" &&
        a.status !== "faltou" &&
        a.status !== "compareceu" &&
        (!a.startsAt || new Date(a.startsAt).getTime() >= now),
    )
    .sort((a, b) => {
      if (!a.startsAt) return 1;
      if (!b.startsAt) return -1;
      return a.startsAt.localeCompare(b.startsAt);
    })
    .slice(0, UPCOMING_LIMIT);
}

/** Minutos desde o início da grade (hora local do navegador). */
function minutesFrom(date: Date, hourStart: number): number {
  return (date.getHours() - hourStart) * 60 + date.getMinutes();
}

function rangeLabel(first: Date, last: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  return `${fmt(first)} – ${fmt(last)}`;
}
