import type { ConversationStatus, LeadTemperature } from '@dentaltrack/shared';

/**
 * Score de temperatura do lead (BE-3.5) — função pura, calculada on-read no
 * GET /leads (sem persistência/migration). Modelo aditivo simples: conversão
 * (agendou) + engajamento (mensagens do cliente) + interesse (tags) +
 * recência (última atividade), com penalidade de abandono. 0–100 → faixa
 * quente/médio/fraco para o dono priorizar quem tem mais chance de converter.
 */

/** Conversão: lead com agendamento (appointment ou conversa `agendada`). */
const CONVERSION_POINTS = 30;
/** Engajamento: até +35, saturando em 8 mensagens do cliente. */
const ENGAGEMENT_MAX_POINTS = 35;
const ENGAGEMENT_SATURATION_MESSAGES = 8;
/** Interesse: +12 por unidade de confiança de tag, com teto de +20. */
const INTEREST_POINTS_PER_CONFIDENCE = 12;
const INTEREST_MAX_POINTS = 20;
/** Recência: degraus por horas desde a última atividade (24h/72h/7d). */
const RECENCY_TIERS: ReadonlyArray<{ maxHours: number; points: number }> = [
  { maxHours: 24, points: 15 },
  { maxHours: 72, points: 10 },
  { maxHours: 168, points: 5 },
];
/** Abandono: conversa mais recente abandonada sem nunca ter agendado. */
const ABANDONMENT_PENALTY = 20;
/** Limiares das faixas: >= 60 quente · >= 30 médio · senão fraco. */
const HOT_THRESHOLD = 60;
const WARM_THRESHOLD = 30;

/** Sinais por lead, agregados das suas conversas (escopadas por empresa). */
export interface LeadScoreSignals {
  /** Lead tem appointment OU alguma conversa `agendada`. */
  hasAppointment: boolean;
  /** Total de mensagens `role='user'` nas conversas do lead. */
  patientMessages: number;
  /** Confiança (0..1) por tag distinta (maior confiança de cada). */
  tagConfidences: number[];
  /** `lastMessageAt` mais recente entre as conversas. */
  lastActivityAt: Date | null;
  /** Status da conversa mais recente. */
  latestStatus: ConversationStatus | null;
}

export interface LeadScore {
  score: number;
  temperature: LeadTemperature;
}

/** Pontos de recência a partir das horas desde a última atividade. */
function recencyPoints(lastActivityAt: Date | null, now: Date): number {
  if (!lastActivityAt) return 0;
  const hours = (now.getTime() - lastActivityAt.getTime()) / 3_600_000;
  for (const tier of RECENCY_TIERS) {
    if (hours < tier.maxHours) return tier.points;
  }
  return 0;
}

/** Calcula score (0–100, inteiro) e temperatura de um lead. */
export function scoreLead(
  signals: LeadScoreSignals,
  now: Date = new Date(),
): LeadScore {
  let total = 0;

  if (signals.hasAppointment) total += CONVERSION_POINTS;

  total +=
    (Math.min(signals.patientMessages, ENGAGEMENT_SATURATION_MESSAGES) /
      ENGAGEMENT_SATURATION_MESSAGES) *
    ENGAGEMENT_MAX_POINTS;

  const interest = signals.tagConfidences.reduce(
    (sum, confidence) => sum + confidence * INTEREST_POINTS_PER_CONFIDENCE,
    0,
  );
  total += Math.min(interest, INTEREST_MAX_POINTS);

  total += recencyPoints(signals.lastActivityAt, now);

  if (signals.latestStatus === 'abandonada' && !signals.hasAppointment) {
    total -= ABANDONMENT_PENALTY;
  }

  const score = Math.min(100, Math.max(0, Math.round(total)));
  const temperature: LeadTemperature =
    score >= HOT_THRESHOLD
      ? 'quente'
      : score >= WARM_THRESHOLD
        ? 'medio'
        : 'fraco';

  return { score, temperature };
}
