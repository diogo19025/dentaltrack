import { zonedTimeToUtc } from '../common/time';

/**
 * Leitura **tolerante** das respostas do sistema de gestão (F9).
 *
 * Este arquivo existe por causa de um risco assumido conscientemente: quando o
 * conector foi escrito, a credencial do cliente ainda não existia. Os caminhos
 * das rotas vêm de um inventário confiável, mas o **formato exato das
 * respostas** (nome e caixa dos campos, onde a lista vem embrulhada) só se
 * confirma com uma chamada real.
 *
 * A resposta a isso não é adivinhar melhor — é não depender de ter adivinhado
 * certo. Todo acesso a campo passa por aqui, tentando as grafias plausíveis
 * (`PatientName`, `patient_name`, `patientName`) e desembrulhando as formas
 * usuais de lista. Quando a credencial chegar, o conserto de um campo divergente
 * é uma entrada numa lista, num arquivo — não uma caçada por cinco automações.
 */

type Row = Record<string, unknown>;

/** É um objeto simples (e não array/null)? */
function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normaliza um nome de campo para comparação: minúsculas, sem separadores.
 * `Clinic_BusinessId`, `clinic business id` e `clinicBusinessId` colapsam todos
 * em `clinicbusinessid`.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_\-.]/g, '');
}

/**
 * Primeiro valor não-vazio entre os nomes candidatos. A comparação é
 * insensível a caixa e a separadores, então cada campo precisa de uma grafia
 * só na lista de candidatos — não das quatro variações.
 */
export function pick(row: unknown, ...candidates: string[]): unknown {
  if (!isRow(row)) return undefined;
  const wanted = candidates.map(normalizeKey);
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || value === '') continue;
    if (wanted.includes(normalizeKey(key))) return value;
  }
  return undefined;
}

/** Texto não-vazio, ou `null`. */
export function readString(
  row: unknown,
  ...candidates: string[]
): string | null {
  const value = pick(row, ...candidates);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

/**
 * Identificador, sempre devolvido como texto. Os ids externos chegam ora como
 * número, ora como string; guardá-los como texto no nosso lado evita comparar
 * `123` com `"123"` e não achar nada.
 */
export function readId(row: unknown, ...candidates: string[]): string | null {
  const value = pick(row, ...candidates);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') return value.trim() || null;
  return null;
}

/** Número, ou `null`. Aceita numérico em texto ("30"). */
export function readNumber(
  row: unknown,
  ...candidates: string[]
): number | null {
  const value = pick(row, ...candidates);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Desembrulha a lista de uma resposta. A mesma API costuma devolver ora um
 * array puro, ora `{ data: [...] }`, ora `{ Result: [...] }` — e uma resposta
 * de erro embrulhada num objeto vira lista vazia em vez de exceção, porque
 * agenda indisponível é caso de degradar, não de derrubar o atendimento.
 */
export function readList(payload: unknown, ...candidates: string[]): Row[] {
  if (Array.isArray(payload)) return payload.filter(isRow);
  if (!isRow(payload)) return [];

  const wrappers = [
    ...candidates,
    'data',
    'result',
    'results',
    'records',
    'items',
    'list',
    'rows',
  ];
  for (const key of wrappers) {
    const value = pick(payload, key);
    if (Array.isArray(value)) return value.filter(isRow);
    // Alguns wrappers aninham mais um nível: { data: { records: [...] } }.
    if (isRow(value)) {
      for (const inner of ['data', 'records', 'items', 'list', 'rows']) {
        const nested = pick(value, inner);
        if (Array.isArray(nested)) return nested.filter(isRow);
      }
    }
  }
  return [];
}

/**
 * Data/hora vinda do sistema externo, interpretada **no fuso da empresa**.
 *
 * Aceita as formas que aparecem na prática: ISO com offset (respeitado como
 * veio), "AAAA-MM-DD HH:mm[:ss]", "AAAA-MM-DD" + campo de hora separado,
 * "DD/MM/AAAA" e o compacto "AAAAMMDD". Data sem offset **não** é UTC: é hora
 * de parede da clínica, e tratá-la como UTC erraria o lembrete em três horas.
 */
export function readDateTime(
  row: unknown,
  options: {
    dateKeys: string[];
    timeKeys?: string[];
    timeZone: string;
  },
): Date | null {
  const raw = readString(row, ...options.dateKeys);
  if (!raw) return null;
  const time = options.timeKeys ? readString(row, ...options.timeKeys) : null;
  return parseExternalDateTime(raw, time, options.timeZone);
}

/** Núcleo textual do `readDateTime` — exposto para teste direto. */
export function parseExternalDateTime(
  raw: string,
  time: string | null,
  timeZone: string,
): Date | null {
  const value = raw.trim();

  // ISO com offset explícito (…Z ou ±HH:mm): já é um instante, respeita-se.
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parts = parseDateParts(value);
  if (!parts) return null;

  const clock = parseClock(
    // Hora embutida na própria data ("2026-09-12 14:30") tem precedência sobre
    // o campo separado: é a mais específica das duas.
    /[T\s]\d{1,2}:\d{2}/.test(value) ? value : (time ?? ''),
  );

  return zonedTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: clock.hour,
      minute: clock.minute,
    },
    timeZone,
  );
}

function parseDateParts(
  value: string,
): { year: number; month: number; day: number } | null {
  // AAAA-MM-DD (com ou sem hora colada)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
    };
  }

  // DD/MM/AAAA
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value);
  if (br) {
    return {
      year: Number(br[3]),
      month: Number(br[2]),
      day: Number(br[1]),
    };
  }

  // AAAAMMDD (a forma compacta usada nas consultas de disponibilidade)
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compact) {
    return {
      year: Number(compact[1]),
      month: Number(compact[2]),
      day: Number(compact[3]),
    };
  }

  return null;
}

function parseClock(value: string): { hour: number; minute: number } {
  const match = /(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return { hour: 0, minute: 0 };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return { hour: 0, minute: 0 };
  return { hour, minute };
}

/** Data no formato compacto AAAAMMDD que as consultas de agenda esperam. */
export function toCompactDate(date: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return formatted.replace(/-/g, '');
}

/**
 * Campos que o sistema externo trata como **id de entidade**. Há evidência real
 * de que ele rejeita esses ids quando chegam como texto ("123") e aceita os
 * mesmos como inteiro nativo (123) — então a conversão acontece na serialização.
 *
 * A lista é deliberadamente curta: documento, telefone e identificadores com
 * zero à esquerda são textos que por acaso só têm dígitos, e convertê-los
 * destruiria o valor.
 */
const ENTITY_ID_FIELDS = new Set(
  [
    'Clinic_BusinessId',
    'Dentist_PersonId',
    'Patient_PersonId',
    'subscriber_id',
    'business_id',
    'appointment_id',
    'status_id',
  ].map(normalizeKey),
);

/**
 * Prepara o corpo de uma escrita: ids de entidade em decimal canônico viram
 * inteiro nativo; todo o resto passa intocado.
 */
export function normalizeEntityIds(body: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(body)) {
    if (
      ENTITY_ID_FIELDS.has(normalizeKey(key)) &&
      typeof value === 'string' &&
      /^\d{1,15}$/.test(value) &&
      !/^0\d/.test(value)
    ) {
      out[key] = Number(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}
