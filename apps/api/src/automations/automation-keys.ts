import type { AutomationKind } from '@dentaltrack/shared';

/**
 * Chaves de idempotência da fila de saída (F9).
 *
 * Cada disparo tem uma chave única por empresa, e é ela que garante que
 * reinício de processo, cron sobreposto ou re-sincronização da agenda não
 * gerem um segundo lembrete para o mesmo cliente.
 *
 * O detalhe que faz o desenho funcionar: as chaves dos lembretes **incluem o
 * horário da consulta**. Se a consulta for remarcada, a chave nova não existe
 * (então o lembrete correto é enfileirado) e a antiga deixa de corresponder ao
 * agendamento (então o lembrete velho é suprimido na revalidação). Remarcação
 * se resolve sozinha, sem nenhum código de "cancelar e reagendar".
 */

/** Instante → sufixo estável e curto (minutos desde a época). */
function stamp(date: Date): string {
  return String(Math.floor(date.getTime() / 60_000));
}

export function reminderKey(
  kind: Extract<AutomationKind, 'lembrete_3d' | 'lembrete_1d' | 'lembrete_1h'>,
  appointmentId: string,
  startsAt: Date,
): string {
  return `${kind}:${appointmentId}:${stamp(startsAt)}`;
}

export function lateKey(appointmentId: string, startsAt: Date): string {
  return `atraso:${appointmentId}:${stamp(startsAt)}`;
}

/**
 * A cadência de falta numera as tentativas: cada uma é uma mensagem distinta
 * na fila, o que deixa o teto (`attempts`) visível no próprio dado.
 */
export function noShowKey(appointmentId: string, attempt: number): string {
  return `falta:${appointmentId}:${attempt}`;
}

/** O retorno acontece uma vez por atendimento concluído. */
export function recallKey(appointmentId: string): string {
  return `retorno:${appointmentId}`;
}
