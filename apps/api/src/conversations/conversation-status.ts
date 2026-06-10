import type { ConversationStatus } from '@dentaltrack/shared';

/**
 * Máquina de status da conversa (BE-1.7).
 * em_andamento → agendada (conversão) | abandonada (inatividade).
 * abandonada → em_andamento (reabre se voltar atividade — uso futuro).
 * agendada é terminal. Sem cron ainda.
 */
export const ALLOWED_TRANSITIONS: Record<
  ConversationStatus,
  ConversationStatus[]
> = {
  em_andamento: ['agendada', 'abandonada'],
  agendada: [],
  abandonada: ['em_andamento'],
};

/** Indica se a transição `from → to` é permitida (mesmo estado = no-op válido). */
export function canTransition(
  from: ConversationStatus,
  to: ConversationStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}
