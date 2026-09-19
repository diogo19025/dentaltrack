import type { AppointmentSummary } from "@dentaltrack/shared";

/**
 * Formatação de datas da agenda, no fuso do navegador. Compartilhada pela
 * página `/agenda` e pelo painel de detalhe do agendamento, para que a mesma
 * consulta seja escrita do mesmo jeito nos dois lugares.
 */

export const DAY_MS = 24 * 3_600_000;

/** Duração assumida quando o agendamento não trouxe `endsAt`. */
export const DEFAULT_DURATION_MS = 30 * 60_000;

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatHm(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "sex., 12/09 às 14:30". */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  return `${day} às ${formatHm(date)}`;
}

/** "hoje" · "amanhã" · "ontem" · null quando está mais longe que isso. */
export function relativeDayLabel(date: Date, now = new Date()): string | null {
  const diff = Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS,
  );
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff === -1) return "ontem";
  return null;
}

/** "hoje às 09:00" · "amanhã às 09:00" · "sex., 12/09 às 14:30". */
export function formatWhenRelative(iso: string): string {
  const date = new Date(iso);
  const day = relativeDayLabel(date);
  return day ? `${day} às ${formatHm(date)}` : formatWhen(iso);
}

/** "sexta-feira, 12 de setembro". */
export function formatLongDay(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** Início e fim do agendamento como datas, com a duração padrão sem `endsAt`. */
export function appointmentRange(
  appointment: Pick<AppointmentSummary, "startsAt" | "endsAt">,
): { startsAt: Date; endsAt: Date } | null {
  if (!appointment.startsAt) return null;
  const startsAt = new Date(appointment.startsAt);
  const endsAt = appointment.endsAt
    ? new Date(appointment.endsAt)
    : new Date(startsAt.getTime() + DEFAULT_DURATION_MS);
  return { startsAt, endsAt };
}

/** "45 min" · "1 h" · "1 h 30". */
export function formatDuration(startsAt: Date, endsAt: Date): string {
  const minutes = Math.max(
    0,
    Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${pad2(rest)}`;
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function dateKeyPlus(days: number): string {
  return dateKey(new Date(Date.now() + days * DAY_MS));
}

/** ISO → valor aceito pelo input datetime-local, no fuso do navegador. */
export function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
