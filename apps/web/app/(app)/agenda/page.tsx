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
import { AppointmentActions } from "@/components/agenda/appointment-actions";
import { ScheduledMessagesCard } from "@/components/agenda/scheduled-messages";
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
const HOUR_PX = 48;
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
 * o mesmo dado que o assistente oferece aos clientes. Abaixo, o histórico das mensagens
 * automáticas — o que saiu e o que foi suprimido, com o motivo.
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

  // Busca + filtros (situação, procedimento, cliente) — valem para a grade
  // e para a lista de próximos, como num calendário de verdade.
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
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente ou procedimento"
            className="h-9 w-[240px] pl-8"
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
                    <span
                      className="size-2.5 flex-none rounded-full"
                      style={{
                        background: professionalColor(
                          professional,
                          professionals,
                        ),
                      }}
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

      <WeekGrid
        weekStart={weekStart}
        appointments={weekAppointments}
        loading={weekLoading}
        colorOf={colorOf}
        legend={activeProfessionals.length > 1 ? activeProfessionals : []}
        allProfessionals={professionals}
        onPrev={() => setWeekOffset((v) => v - 1)}
        onNext={() => setWeekOffset((v) => v + 1)}
        onToday={() => setWeekOffset(0)}
        isCurrentWeek={weekOffset === 0}
      />

      <OwnerOnly>
        <ScheduledMessagesCard history={history} />
      </OwnerOnly>
    </>
  );
}

/* ─────────────────────────── Próximos agendamentos ─────────────────────────── */

function UpcomingSection({
  appointments,
  loading,
  colorOf,
}: {
  appointments: AppointmentSummary[];
  loading: boolean;
  colorOf: ColorOf;
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
            <Skeleton key={i} className="h-[92px] rounded-[var(--radius-sm)]" />
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {appointments.map((appointment) => (
            <Card key={appointment.id} className="gap-1.5 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="tabular text-[13px] font-semibold text-primary">
                  {appointment.startsAt
                    ? formatWhen(appointment.startsAt)
                    : (appointment.preferredTime ?? "A combinar")}
                </span>
                <div className="flex items-center gap-1">
                  <AppointmentBadge status={appointment.status} />
                  <AppointmentActions appointment={appointment} />
                </div>
              </div>
              <div className="truncate text-sm font-medium">
                {appointment.leadName ?? "Sem nome"}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
                <span
                  className="size-2 flex-none rounded-full"
                  style={{ background: colorOf(appointment) }}
                />
                <span className="truncate font-medium">
                  {appointment.procedureName ?? "Consulta"}
                </span>
                {appointment.professionalName && (
                  <span className="truncate text-muted-foreground">
                    · {appointment.professionalName}
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
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
}

function WeekGrid({
  weekStart,
  appointments,
  loading,
  colorOf,
  legend,
  allProfessionals,
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
      const s = new Date(a.startsAt as string);
      const e = a.endsAt
        ? new Date(a.endsAt)
        : new Date(s.getTime() + 30 * 60_000);
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
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-[14px]">
        <div>
          <div className="text-base font-semibold tracking-[-0.01em]">
            Grade da semana
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {rangeLabel(days[0], days[days.length - 1])}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {legend.length > 0 && (
            <Legend professionals={legend} all={allProfessionals} />
          )}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Semana anterior"
              onClick={onPrev}
            >
              <ChevronLeft className="size-4" />
            </Button>
            {!isCurrentWeek && (
              <Button type="button" variant="outline" onClick={onToday}>
                Hoje
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Próxima semana"
              onClick={onNext}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

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
                    className="absolute right-1.5 -translate-y-1/2 text-[11px] text-muted-foreground"
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
                    className="relative border-l border-border"
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
                      ({ appointment, top, height, startsAt, endsAt }) => {
                        const missed =
                          appointment.status === "faltou" ||
                          appointment.status === "cancelado";
                        const range = `${formatHm(startsAt)} – ${formatHm(endsAt)}`;
                        const color = colorOf(appointment);
                        return (
                          <div
                            key={appointment.id}
                            className={cn(
                              "absolute inset-x-1 overflow-hidden rounded-[var(--radius-sm)] px-1.5 py-1 text-left",
                              missed
                                ? "status-abandonada"
                                : "text-primary-foreground",
                            )}
                            style={{
                              top,
                              height,
                              ...(missed ? {} : { background: color }),
                            }}
                            title={`${range} · ${appointment.leadName ?? "Sem nome"}${appointment.procedureName ? ` · ${appointment.procedureName}` : ""}${appointment.professionalName ? ` · ${appointment.professionalName}` : ""} (${APPOINTMENT_STATUS_LABELS[appointment.status]})`}
                          >
                            {height >= 40 ? (
                              <>
                                <div className="truncate text-[10px] leading-tight opacity-90">
                                  {range}
                                </div>
                                <div className="truncate text-[11px] font-semibold leading-tight">
                                  {appointment.leadName ?? "Sem nome"}
                                </div>
                                {height >= 56 && (
                                  <div className="truncate text-[10px] font-medium leading-tight opacity-90">
                                    {appointment.procedureName ?? "Consulta"}
                                    {appointment.professionalName
                                      ? ` · ${appointment.professionalName}`
                                      : ""}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="truncate text-[11px] font-semibold leading-tight">
                                {formatHm(startsAt)} ·{" "}
                                {appointment.leadName ?? "Sem nome"}
                                {appointment.procedureName
                                  ? ` · ${appointment.procedureName}`
                                  : ""}
                              </div>
                            )}
                          </div>
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
          <span
            aria-hidden="true"
            className="size-2.5 flex-none rounded-full"
            style={{ background: professionalColor(professional, all) }}
          />
          {professional.name}
        </li>
      ))}
      {rest > 0 && <li>+{rest}</li>}
    </ul>
  );
}

/** Blocos de atendimento do dia, posicionados na grade. */
function appointmentBlocksFor(
  day: Date,
  appointments: AppointmentSummary[],
  hourStart: number,
): AppointmentBlock[] {
  const dayStart = day.getTime();
  const dayEnd = dayStart + DAY_MS;
  return appointments
    .filter((a) => {
      const t = new Date(a.startsAt as string).getTime();
      return t >= dayStart && t < dayEnd;
    })
    .map((appointment) => {
      const startsAt = new Date(appointment.startsAt as string);
      const endsAt = appointment.endsAt
        ? new Date(appointment.endsAt)
        : new Date(startsAt.getTime() + 30 * 60_000);
      return {
        appointment,
        startsAt,
        endsAt,
        top: minutesFrom(startsAt, hourStart) * (HOUR_PX / 60),
        height: Math.max(
          ((endsAt.getTime() - startsAt.getTime()) / 60_000) * (HOUR_PX / 60) -
            2,
          22,
        ),
      };
    });
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

/** Situação do agendamento, com as cores já existentes de status. */
function AppointmentBadge({ status }: { status: AppointmentStatus }) {
  const tone =
    status === "faltou" || status === "cancelado"
      ? "status-abandonada"
      : status === "compareceu" || status === "confirmado"
        ? "status-agendada"
        : "status-em_andamento";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[5px] text-[12px] font-medium",
        tone,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {APPOINTMENT_STATUS_LABELS[status]}
    </span>
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

/* ─────────────────────────── Datas & formatação ─────────────────────────── */

const DAY_MS = 24 * 3_600_000;

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

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Minutos desde o início da grade (hora local do navegador). */
function minutesFrom(date: Date, hourStart: number): number {
  return (date.getHours() - hourStart) * 60 + date.getMinutes();
}

/** "sexta, 12/09 às 14:30" no fuso do navegador. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  return `${day} às ${formatHm(date)}`;
}

function formatHm(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function rangeLabel(first: Date, last: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  return `${fmt(first)} – ${fmt(last)}`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateKeyPlus(days: number): string {
  return dateKey(new Date(Date.now() + days * DAY_MS));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
