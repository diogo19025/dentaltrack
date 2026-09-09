import {
  ConsoleLogger,
  type LoggerService,
  type LogLevel,
} from '@nestjs/common';
import { getContext } from './request-context';
import { redact, redactText } from './redact';

/**
 * Logger da API (P0.3).
 *
 * Em produção emite **uma linha JSON por evento**, com o contexto de correlação
 * anexado automaticamente — é o que torna o log filtrável por empresa, conversa
 * ou operação. Em desenvolvimento delega ao logger colorido do Nest, porque
 * JSON no terminal é ilegível.
 *
 * Duas propriedades importantes do desenho:
 *
 * 1. **Nenhum serviço precisou mudar.** Quem já chama `this.logger.warn('...')`
 *    passa a sair correlacionado e redigido de graça.
 * 2. **Quem quer campo estruturado passa um objeto**: `this.logger.log({ event:
 *    'ai.reply', outcome: 'ok', durationMs })`. Os campos entram no JSON em vez
 *    de virarem texto interpolado — que é o que hoje impede buscar no log.
 *
 * `LOG_FORMAT=pretty|json` força o formato; sem ela, `NODE_ENV=production`
 * decide. A variável existe para dar caminho de volta se o formato novo
 * atrapalhar alguma investigação.
 */

/** Campos estruturados de um evento. `event` é o que se usa para filtrar. */
export interface LogEvent {
  /** Nome estável e pesquisável: `whatsapp.inbound`, `agenda.book`, … */
  event: string;
  outcome?: 'ok' | 'fail';
  durationMs?: number;
  /** Categoria do erro quando `outcome: 'fail'` — nunca o payload. */
  reason?: string;
  [key: string]: unknown;
}

function isLogEvent(value: unknown): value is LogEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as LogEvent).event === 'string'
  );
}

const LEVEL_LABEL: Record<string, string> = {
  log: 'info',
  error: 'error',
  warn: 'warn',
  debug: 'debug',
  verbose: 'verbose',
  fatal: 'fatal',
};

export class StructuredLogger implements LoggerService {
  private readonly pretty: ConsoleLogger | null;

  constructor(json = shouldUseJson()) {
    this.pretty = json ? null : new ConsoleLogger();
  }

  log(message: unknown, ...params: unknown[]): void {
    this.write('log', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  private write(level: LogLevel, message: unknown, params: unknown[]): void {
    if (this.pretty) {
      // Mesmo no formato legível o dado pessoal é redigido: o terminal de
      // desenvolvimento também acaba colado em issue e em chat de suporte.
      this.pretty[level](redact(message), ...params.map((p) => redact(p)));
      return;
    }

    // O Nest passa o contexto (nome da classe) como último parâmetro string, e
    // no `error` insere a stack antes dele.
    const context =
      typeof params.at(-1) === 'string' ? (params.at(-1) as string) : undefined;
    const rest = context ? params.slice(0, -1) : params;
    const stack = rest.find(
      (p): p is string => typeof p === 'string' && p.includes('\n'),
    );

    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: LEVEL_LABEL[level] ?? level,
      ...(context ? { ctx: context } : {}),
    };

    if (isLogEvent(message)) {
      const { event, ...fields } = message;
      entry.event = event;
      Object.assign(entry, redact(fields) as Record<string, unknown>);
    } else if (typeof message === 'string') {
      entry.msg = redactText(message);
    } else {
      entry.msg = redact(message);
    }

    Object.assign(entry, getContext());
    if (stack) entry.stack = redactText(stack);

    // Uma linha por evento: é o que os agregadores de log (Railway, Vercel,
    // Sentry) sabem consumir sem configuração.
    process.stdout.write(`${safeStringify(entry)}\n`);
  }
}

/** JSON em produção; legível em desenvolvimento. `LOG_FORMAT` tem prioridade. */
export function shouldUseJson(): boolean {
  const forced = process.env.LOG_FORMAT;
  if (forced === 'json') return true;
  if (forced === 'pretty') return false;
  return process.env.NODE_ENV === 'production';
}

/**
 * Um log que estoura por referência circular derruba a operação que o emitiu —
 * o inverso do que observabilidade deveria fazer.
 */
function safeStringify(entry: Record<string, unknown>): string {
  try {
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({
      ts: entry.ts,
      level: entry.level,
      msg: '[log não serializável]',
    });
  }
}
