/**
 * Retry com espera crescente para chamadas a APIs externas (P0.1).
 *
 * **Só serve para leitura.** Não há nada aqui que impeça o uso numa escrita, e é
 * por isso que a regra está escrita: repetir um `createEvent` que na verdade
 * deu certo (a resposta é que se perdeu) é literalmente como se produz um
 * agendamento duplicado. A recuperação de escrita neste produto é a
 * `bookingKey` do P0.5, não o transporte.
 *
 * `isRetryable` é obrigatório de propósito. Um default "repete tudo" faria o
 * transporte insistir contra credencial recusada e contra bug de parsing — as
 * duas falhas em que repetir só multiplica o dano e atrasa o diagnóstico.
 */

/** Tentativas totais (a primeira mais duas repetições) e espera inicial. */
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;

export interface RetryOptions {
  /** Tentativas **totais**, incluindo a primeira. Menor que 2 desliga o retry. */
  attempts?: number;
  /** Espera antes da 2ª tentativa; dobra a cada repetição. */
  baseDelayMs?: number;
  /** O que vale a pena repetir. Sem isto, nada é repetido. */
  isRetryable: (err: unknown) => boolean;
  /** Observabilidade: chamado antes de cada espera. */
  onRetry?: (info: { attempt: number; delayMs: number; err: unknown }) => void;
  /** Injetáveis para teste determinístico. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Última tentativa ou falha definitiva: o erro sobe como veio, com a
      // categoria intacta — quem chamou precisa dela para decidir o que dizer.
      if (attempt === attempts || !options.isRetryable(err)) throw err;

      const delayMs = backoffDelay(baseDelayMs, attempt, random);
      options.onRetry?.({ attempt, delayMs, err });
      await sleep(delayMs);
    }
  }
  // Inalcançável: o laço ou retorna ou lança. Mantido para o compilador.
  throw lastError;
}

/**
 * Espera exponencial com jitter de até 50%.
 *
 * O jitter não é enfeite: o cron de sincronização acorda todas as empresas no
 * mesmo tique, e um backoff fixo faria todas repetirem no mesmo milissegundo —
 * mantendo de pé exatamente a sobrecarga da qual se está tentando escapar.
 */
function backoffDelay(
  baseDelayMs: number,
  attempt: number,
  random: () => number,
): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  return Math.round(exponential * (1 + random() * 0.5));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
