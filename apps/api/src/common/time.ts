/**
 * Datas no fuso da empresa (F9) — sem biblioteca externa, via `Intl`.
 *
 * Por que isto existe: a API roda em UTC (Railway) e a empresa vive em -03:00.
 * "3 dias antes às 9h" calculado em UTC chega três horas fora, "não enviar
 * depois das 20h" barra o horário errado, e "quantas mensagens saíram hoje"
 * conta o dia errado perto da meia-noite. Um lembrete no horário errado é pior
 * do que lembrete nenhum, então toda conversão passa por aqui.
 *
 * O sistema de gestão externo piora o quadro: ele devolve data e hora **sem
 * offset** ("2026-09-12 14:30"), que só significa alguma coisa quando lida no
 * fuso da empresa — é exatamente o que `zonedTimeToUtc` faz.
 */

/** Componentes de um instante já lidos no fuso da empresa. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const WEEKDAY_PT = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

/** Fuso usado quando a empresa ainda não configurou o dela. */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
}

/** Lê um instante nos componentes do fuso pedido. */
export function toZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // 24h em `en-US` devolve "24" à meia-noite; normalizamos para 0.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** Deslocamento do fuso (ms) no instante dado — respeita horário de verão. */
function offsetMs(date: Date, timeZone: string): number {
  const p = toZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
  // Segundos são descartados de propósito: os offsets de fuso são múltiplos de
  // minuto, e ignorá-los evita erro de arredondamento na volta.
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/**
 * Converte uma "hora de parede" do fuso da empresa para o instante UTC.
 *
 * Duas passadas de propósito: o deslocamento depende do instante (horário de
 * verão), e o instante é justamente o que estamos procurando. A primeira passada
 * chuta usando o offset do palpite; a segunda corrige usando o offset do
 * resultado — o que basta para todos os casos exceto a hora que não existe na
 * virada do horário de verão, e o Brasil não tem mais horário de verão.
 */
export function zonedTimeToUtc(
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
  },
  timeZone: string,
): Date {
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    0,
  );
  const firstGuess = new Date(asUtc - offsetMs(new Date(asUtc), timeZone));
  return new Date(asUtc - offsetMs(firstGuess, timeZone));
}

/** Chave do dia no fuso da empresa (AAAA-MM-DD) — feriado e teto diário. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = toZonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Meia-noite (no fuso da empresa) do dia em que o instante cai. */
export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = toZonedParts(date, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/** Minutos desde a meia-noite, no fuso da empresa (janela de envio). */
export function zonedMinutesOfDay(date: Date, timeZone: string): number {
  const p = toZonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** "HH:mm" → minutos desde a meia-noite. Formato inválido → `fallback`. */
export function parseHhMm(value: string, fallback: number): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Data por extenso para os textos das automações: "sexta-feira, 12/09". */
export function formatDatePtBr(date: Date, timeZone: string): string {
  const p = toZonedParts(date, timeZone);
  return `${WEEKDAY_PT[p.weekday]}, ${pad(p.day)}/${pad(p.month)}`;
}

/** Hora para os textos das automações: "14:30". */
export function formatTimePtBr(date: Date, timeZone: string): string {
  const p = toZonedParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** AAAA-MM-DD (chave de dia) → meia-noite daquele dia no fuso da empresa. */
export function dateKeyToUtc(dateKey: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!match) return null;
  return zonedTimeToUtc(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    },
    timeZone,
  );
}

/**
 * Data/hora que o **agente** informou, lida no fuso da empresa.
 *
 * O modelo devolve "2026-09-12T14:30" (ou "2026-09-12 14:30") depois de acertar
 * com o cliente. Sem offset, isso é hora de parede da clínica — interpretá-la
 * como UTC marcaria a consulta três horas fora. Se vier com offset explícito,
 * respeita-se o que veio.
 */
export function parseLocalDateTime(
  value: string,
  timeZone: string,
): Date | null {
  const raw = value.trim();
  if (!raw) return null;

  if (/(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})/.exec(raw);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  if (Number(hour) > 23 || Number(minute) > 59) return null;

  return zonedTimeToUtc(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
    },
    timeZone,
  );
}

/**
 * Instante → "AAAA-MM-DDTHH:mm" na hora de parede da empresa — o inverso de
 * `parseLocalDateTime`, e o único formato que o agente troca com as tools de
 * agenda. Nunca devolver ISO UTC ao modelo: ele copia o "13:00" do rótulo para
 * dentro de um string com `Z` e a consulta cai três horas fora.
 */
export function formatLocalDateTime(date: Date, timeZone: string): string {
  const p = toZonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** É sábado ou domingo no fuso da empresa? */
export function isZonedWeekend(date: Date, timeZone: string): boolean {
  const weekday = toZonedParts(date, timeZone).weekday;
  return weekday === 0 || weekday === 6;
}

/** Soma dias mantendo a mesma hora de parede no fuso da empresa. */
export function addZonedDays(date: Date, days: number, timeZone: string): Date {
  const p = toZonedParts(date, timeZone);
  return zonedTimeToUtc(
    {
      year: p.year,
      month: p.month,
      day: p.day + days,
      hour: p.hour,
      minute: p.minute,
    },
    timeZone,
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
