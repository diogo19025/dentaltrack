import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext } from './request-context';

/** Cabeçalho de correlação, aceito na entrada e devolvido na saída. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Um id de correlação por request (P0.3).
 *
 * Aceita o id que o front mandar — assim uma falha reportada pelo usuário tem o
 * mesmo código na tela e no log do servidor — e gera um quando não vem.
 *
 * Registrado como middleware Express puro em `main.ts` (`app.use`), não via
 * `MiddlewareConsumer`: o casamento de rota curinga mudou entre versões do Nest,
 * e aqui a regra é literalmente "todo request", sem exceção.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = sanitize(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithContext({ requestId, channel: 'web' }, () => next());
}

/**
 * O id vai direto para a linha de log, então valor vindo de fora é validado:
 * um cabeçalho com quebra de linha forjaria entradas de log inteiras.
 */
function sanitize(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return /^[\w:-]+$/.test(trimmed) ? trimmed : null;
}
