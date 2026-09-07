"use client";

import { useMemo, useState } from "react";
import {
  APPOINTMENT_STATUS_LABELS,
  AUTOMATION_LABELS,
  type AppointmentStatus,
  type AppointmentSummary,
  type AvailableSlot,
  type OutboundMessageSummary,
} from "@dentaltrack/shared";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Link2,
  PlugZap,
  RefreshCw,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";
import { useAgenda, useAvailability, useSyncAgenda } from "@/hooks/use-agenda";
import { useAutomationHistory } from "@/hooks/use-automations";
import { useIntegration } from "@/hooks/use-integration";
import { cn } from "@/lib/utils";

/** Altura de uma hora na grade, em px. */
const HOUR_PX = 48;
const DAYS_IN_GRID = 7;
const UPCOMING_LIMIT = 4;

/**
 * /agenda (F9) — o que está marcado e o que o sistema mandou.
 *
 * Duas vistas complementares: os **próximos agendamentos** (o que vem aí, em
 * cards) e a **grade da semana** ao estilo Google Agenda — faixas de horário
 * livres (tint) × atendimentos marcados (blocos sólidos), o mesmo dado que o
 * assistente oferece aos clientes. Abaixo, o histórico das mensagens
 * automáticas — o que saiu e o que foi suprimido, com o motivo.
 *
 * Fora do handoff de design; segue o design system existente (plan.md §6).
 */
export default function AgendaPage() {
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
  const { data: upcomingData } = useAgenda(dateKey(new Date()), dateKeyPlus(30));
  // A disponibilidade sempre parte de hoje; pedimos até o fim da semana vista.
  const availabilityDays = Math.min(
    30,
    Math.max(1, (weekOffset + 1) * DAYS_IN_GRID),
  );
  const { data: availability } = useAvailability(availabilityDays);

  const { data: clinicorpIntegration } = useIntegration("clinicorp");
  const { data: googleIntegration } = useIntegration(
    "google",
    clinicorpIntegration?.activeProvider === "google",
  );
  const integration =
    clinicorpIntegration?.activeProvider === "google"
      ? googleIntegration
      : clinicorpIntegration;
  const { data: history = [] } = useAutomationHistory(20);
  const sync = useSyncAgenda();

  const upcoming = useMemo(
    () => pickUpcoming(upcomingData?.appointments ?? []),
    [upcomingData],
  );

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle="Os horários marcados e as mensagens que o assistente enviou sozinho."
      >
        {integration && integration.mode !== "desligado" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} />
            {sync.isPending ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        )}
      </PageHeader>

      <IntegrationStrip
        mode={integration?.mode ?? "desligado"}
        lastSyncedAt={weekData?.lastSyncedAt ?? null}
      />

      <UpcomingSection appointments={upcoming} loading={weekLoading} />

      <WeekGrid
        weekStart={weekStart}
        appointments={weekData?.appointments ?? []}
        freeSlots={availability?.live ? availability.slots : []}
        loading={weekLoading}
        onPrev={() => setWeekOffset((v) => v - 1)}
        onNext={() => setWeekOffset((v) => v + 1)}
        onToday={() => setWeekOffset(0)}
        isCurrentWeek={weekOffset === 0}
      />

      <HistoryCard history={history} />
    </>
  );
}

/* ─────────────────────────── Próximos agendamentos ─────────────────────────── */

function UpcomingSection({
  appointments,
  loading,
}: {
  appointments: AppointmentSummary[];
  loading: boolean;
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
                <AppointmentBadge status={appointment.status} />
              </div>
              <div className="truncate text-sm font-medium">
                {appointment.leadName ?? "Sem nome"}
              </div>
              <div className="truncate text-[13px] text-muted-foreground">
                {appointment.procedureName ?? "Consulta"}
                {appointment.professionalName
                  ? ` · ${appointment.professionalName}`
                  : ""}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────── Grade da semana ─────────────────────────── */

interface DayBlock {
  top: number;
  height: number;
  startsAt: Date;
}
interface FreeBand extends DayBlock {
  endsAt: Date;
}
interface AppointmentBlock extends DayBlock {
  appointment: AppointmentSummary;
}

function WeekGrid({
  weekStart,
  appointments,
  freeSlots,
  loading,
  onPrev,
  onNext,
  onToday,
  isCurrentWeek,
}: {
  weekStart: Date;
  appointments: AppointmentSummary[];
  freeSlots: AvailableSlot[];
  loading: boolean;
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
  const timed = appointments.filter((a) => a.startsAt && a.status !== "cancelado");
  const { hourStart, hourEnd } = useMemo(() => {
    let start = 8;
    let end = 18;
    for (const a of timed) {
      const s = new Date(a.startsAt as string);
      const e = a.endsAt ? new Date(a.endsAt) : new Date(s.getTime() + 30 * 60_000);
      start = Math.min(start, s.getHours());
      end = Math.max(end, e.getMinutes() > 0 ? e.getHours() + 1 : e.getHours());
    }
    for (const slot of freeSlots) {
      const s = new Date(slot.startsAt);
      const e = slot.endsAt ? new Date(slot.endsAt) : s;
      start = Math.min(start, s.getHours());
      end = Math.max(end, e.getMinutes() > 0 ? e.getHours() + 1 : e.getHours());
    }
    return { hourStart: start, hourEnd: Math.max(end, start + 1) };
  }, [timed, freeSlots]);

  const bodyHeight = (hourEnd - hourStart) * HOUR_PX;
  const hours = Array.from({ length: hourEnd - hourStart }, (_, i) => hourStart + i);

  const today = startOfDay(new Date()).getTime();
  const now = new Date();
  const nowTop =
    (now.getHours() - hourStart + now.getMinutes() / 60) * HOUR_PX;

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
        <div className="ml-auto flex items-center gap-3">
          <Legend />
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
                const free = freeBandsFor(day, freeSlots, hourStart);
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

                    {free.map((band, i) => (
                      <div
                        key={`free-${i}`}
                        className="absolute inset-x-1 rounded-[var(--radius-sm)] bg-primary-tint/70"
                        style={{ top: band.top, height: band.height }}
                        title={`Livre ${formatHm(band.startsAt)}–${formatHm(band.endsAt)}`}
                      >
                        {band.height >= 34 && (
                          <span className="block px-1.5 pt-1 text-[10px] font-medium text-primary/80">
                            livre
                          </span>
                        )}
                      </div>
                    ))}

                    {blocks.map(({ appointment, top, height, startsAt }) => {
                      const missed =
                        appointment.status === "faltou" ||
                        appointment.status === "cancelado";
                      return (
                        <div
                          key={appointment.id}
                          className={cn(
                            "absolute inset-x-1 overflow-hidden rounded-[var(--radius-sm)] px-1.5 py-1 text-left",
                            missed
                              ? "status-abandonada"
                              : "bg-primary text-primary-foreground",
                          )}
                          style={{ top, height }}
                          title={`${formatHm(startsAt)} · ${appointment.leadName ?? "Sem nome"}${appointment.procedureName ? ` · ${appointment.procedureName}` : ""}`}
                        >
                          <div className="truncate text-[11px] font-semibold leading-tight">
                            {formatHm(startsAt)} ·{" "}
                            {appointment.leadName ?? "Sem nome"}
                          </div>
                          {height >= 40 && appointment.procedureName && (
                            <div className="truncate text-[10px] leading-tight opacity-85">
                              {appointment.procedureName}
                            </div>
                          )}
                        </div>
                      );
                    })}

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

function Legend() {
  return (
    <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-primary-tint" />
        livre
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-primary" />
        atendimento
      </span>
    </div>
  );
}

/** Horários livres do dia, com faixas contíguas fundidas numa banda só. */
function freeBandsFor(
  day: Date,
  slots: AvailableSlot[],
  hourStart: number,
): FreeBand[] {
  const dayStart = day.getTime();
  const dayEnd = dayStart + DAY_MS;
  const inDay = slots
    .map((slot) => ({
      start: new Date(slot.startsAt),
      end: slot.endsAt
        ? new Date(slot.endsAt)
        : new Date(new Date(slot.startsAt).getTime() + 30 * 60_000),
    }))
    .filter((s) => s.start.getTime() >= dayStart && s.start.getTime() < dayEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: { start: Date; end: Date }[] = [];
  for (const slot of inDay) {
    const last = merged[merged.length - 1];
    if (last && slot.start.getTime() <= last.end.getTime()) {
      if (slot.end.getTime() > last.end.getTime()) last.end = slot.end;
    } else {
      merged.push({ start: slot.start, end: slot.end });
    }
  }

  return merged.map(({ start, end }) => ({
    startsAt: start,
    endsAt: end,
    top: minutesFrom(start, hourStart) * (HOUR_PX / 60),
    height: Math.max(
      ((end.getTime() - start.getTime()) / 60_000) * (HOUR_PX / 60) - 2,
      10,
    ),
  }));
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
        top: minutesFrom(startsAt, hourStart) * (HOUR_PX / 60),
        height: Math.max(
          ((endsAt.getTime() - startsAt.getTime()) / 60_000) * (HOUR_PX / 60) - 2,
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
        <Link2 className="size-4 flex-none" style={{ color: "var(--primary)" }} />
      ) : (
        <PlugZap className="size-4 flex-none text-muted-foreground" />
      )}
      <span className={connected ? "text-primary" : "text-secondary-foreground"}>
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

function HistoryCard({ history }: { history: OutboundMessageSummary[] }) {
  return (
    <Card className="gap-0 p-0">
      <div className="border-b border-border px-6 py-[18px]">
        <div className="text-base font-semibold tracking-[-0.01em]">
          Mensagens automáticas
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          O que saiu — e o que não saiu, com o motivo.
        </div>
      </div>

      {history.length === 0 ? (
        <Empty
          icon={<Send className="size-5" />}
          title="Nada enviado ainda"
          desc="Lembretes e retomadas de contato aparecem aqui assim que houver horários marcados."
        />
      ) : (
        <ul className="divide-y divide-border">
          {history.map((message) => (
            <li key={message.id} className="flex gap-3 px-6 py-3">
              <div className="mt-0.5">
                {message.status === "enviado" ? (
                  <Send className="size-4" style={{ color: "var(--primary)" }} />
                ) : (
                  <CircleSlash className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">
                    {AUTOMATION_LABELS[message.kind]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {message.leadName ?? message.phone ?? "contato"}
                  </span>
                  {message.attempt > 1 && (
                    <span className="text-xs text-muted-foreground">
                      tentativa {message.attempt}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {message.body}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {describeOutcome(message)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const OUTCOME: Record<string, string> = {
  opt_out: "não enviada — o contato pediu para não receber mensagens automáticas",
  sem_telefone: "não enviada — o contato não tem telefone cadastrado",
  whatsapp_nao_configurado: "não enviada — o WhatsApp da empresa não está conectado",
  teto_diario: "não enviada — o limite diário de mensagens foi atingido",
  fora_da_janela: "não enviada — sairia fora do horário e chegaria tarde demais",
  ja_enviado: "não enviada — já havia sido enviada",
  cliente_respondeu: "não enviada — o cliente respondeu e a sequência parou",
  agendamento_mudou: "não enviada — o horário foi remarcado ou cancelado",
};

function describeOutcome(message: OutboundMessageSummary): string {
  if (message.status === "enviado" && message.sentAt) {
    return `Enviada em ${new Date(message.sentAt).toLocaleString("pt-BR")}`;
  }
  if (message.status === "pendente") {
    return `Agendada para ${new Date(message.scheduledFor).toLocaleString("pt-BR")}`;
  }
  if (message.status === "falhou") return "Falha no envio — será tentada de novo";
  if (message.reason) {
    return OUTCOME[message.reason] ?? `Não enviada (${message.reason})`;
  }
  return "Não enviada";
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
function pickUpcoming(appointments: AppointmentSummary[]): AppointmentSummary[] {
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
