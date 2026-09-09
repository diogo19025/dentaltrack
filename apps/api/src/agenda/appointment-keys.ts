import { createHash } from 'node:crypto';

/**
 * Chave de idempotência do agendamento (P0.5).
 *
 * Espelha `automations/automation-keys.ts`: uma chave estável por empresa que
 * transforma "criar agendamento" numa operação segura de repetir. É ela que
 * resolve, de uma vez, os quatro modos de duplicação que o produto tinha:
 * duplo clique, retry após timeout, webhook reentregue e o modelo chamando a
 * tool `bookAppointment` duas vezes no mesmo turno.
 *
 * O que compõe a identidade de um agendamento — **contato, quando e o quê**:
 *
 * - **contato**: a conversa é a identidade preferida porque é ela que delimita
 *   o turno que pode ser repetido. Sem conversa (agendamento manual), cai para
 *   o lead e depois para o telefone.
 * - **quando**: o horário acordado. Quando não há horário — o "pedido" em texto
 *   livre —, usa-se o **dia**, senão o mesmo pedido seria reaberto a cada
 *   mensagem em que o cliente repetisse a intenção.
 * - **o quê**: o procedimento, para que quem pede duas coisas diferentes no
 *   mesmo dia continue conseguindo.
 *
 * **Limite conhecido:** dois pedidos *sem horário definido*, do mesmo contato,
 * para o mesmo procedimento e no mesmo dia colidem — dois familiares no mesmo
 * telefone, por exemplo. Com horário definido não colidem (os horários
 * diferem), e é esse o caso que gera agendamento de verdade.
 */
export interface BookingKeyInput {
  conversationId: string | null;
  leadId: string | null;
  patientPhone: string | null;
  /** Horário acordado. `null` = pedido sem horário. */
  startsAt: Date | null;
  procedureId: string | null;
  procedureName: string | null;
  /** Relógio de referência para o pedido sem horário. Injetável nos testes. */
  now?: Date;
}

/**
 * `null` quando não há identidade nenhuma de contato — sem conversa, sem lead e
 * sem telefone não há o que deduplicar, e uma chave inventada agruparia
 * agendamentos de pessoas diferentes. Coluna nula não colide com nula em
 * Postgres, então esses casos seguem criando linhas independentes, como hoje.
 */
export function bookingKey(input: BookingKeyInput): string | null {
  const contact =
    input.conversationId ?? input.leadId ?? digits(input.patientPhone);
  if (!contact) return null;

  const when = input.startsAt
    ? minutesSinceEpoch(input.startsAt)
    : utcDay(input.now ?? new Date());

  const what =
    input.procedureId ?? normalize(input.procedureName) ?? 'sem-procedimento';

  // Hash em vez de texto legível porque as partes carregam telefone: a chave
  // vive num índice e aparece em log de erro de constraint.
  return createHash('sha256')
    .update(`${contact}|${when}|${what}`)
    .digest('hex')
    .slice(0, 32);
}

/** Instante → sufixo estável e curto, como no `stamp` das automações. */
function minutesSinceEpoch(date: Date): string {
  return String(Math.floor(date.getTime() / 60_000));
}

/** AAAA-MM-DD em UTC — granularidade do pedido sem horário. */
function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function digits(phone: string | null): string | null {
  const only = phone?.replace(/\D/g, '') ?? '';
  return only.length >= 8 ? only : null;
}

/**
 * Marcas de acento na forma decomposta (NFD). Construída a partir de string
 * ASCII de propósito: escrever os caracteres combinantes direto no fonte os
 * deixa invisíveis no editor e frágeis a reencoding do arquivo.
 */
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Nome do procedimento sem acento, caixa nem espaço extra. */
function normalize(name: string | null): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
