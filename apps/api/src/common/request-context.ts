import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Contexto de correlação de uma operação (P0.3).
 *
 * Existe para responder "em qual etapa esta mensagem falhou?" sem abrir o banco.
 * Todo log emitido dentro de um escopo carrega estes campos automaticamente, o
 * que permitiu adicionar correlação **sem tocar nos ~15 serviços** que já usam
 * o `Logger` do Nest — eles continuam chamando `this.logger.warn('...')` e o
 * `StructuredLogger` anexa o contexto na saída.
 */
export interface RequestContext {
  /** Correlaciona todas as linhas de uma mesma operação. */
  requestId: string;
  clinicId?: string;
  conversationId?: string;
  /** `web` | `whatsapp` | `job` — de onde a operação nasceu. */
  channel?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Abre um escopo de correlação. Tudo que rodar dentro de `fn` — inclusive
 * depois de `await` — enxerga este contexto.
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Enriquece o contexto já aberto (o `clinicId` só é conhecido depois do guard;
 * o `conversationId`, depois de resolver a conversa). Silencioso fora de um
 * escopo: enriquecer contexto nunca deve derrubar a operação que o usa.
 */
export function setContext(patch: Partial<RequestContext>): void {
  const current = storage.getStore();
  if (current) Object.assign(current, patch);
}

/**
 * Id de correlação para operações que nascem fora de um request HTTP — rodadas
 * de cron e o processamento assíncrono do webhook. O prefixo diz a origem, o
 * que torna o log filtrável por tipo de operação (`job:`, `wa:`).
 */
export function newCorrelationId(prefix: string): string {
  return `${prefix}:${randomUUID().slice(0, 8)}`;
}
