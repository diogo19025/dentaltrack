import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Uma linha por request (P0.3): método, rota, status e duração.
 *
 * É o piso da observabilidade — permite responder "a chamada chegou?" e "quanto
 * demorou?" antes de olhar qualquer log de domínio. Erros não são logados aqui:
 * o `AllExceptionsFilter` já os registra com o motivo, e duplicar produziria
 * duas linhas para a mesma falha.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Http');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const path = request.originalUrl?.split('?')[0] ?? request.url ?? '';

    // O health check bate a cada poucos segundos no Railway: logá-lo afogaria
    // tudo que interessa.
    if (path === '/health') return next.handle();

    const startedAt = Date.now();
    return next.handle().pipe(
      tap({
        next: () =>
          this.write(request, http.getResponse<Response>(), startedAt),
        error: () => undefined,
      }),
    );
  }

  private write(request: Request, response: Response, startedAt: number): void {
    this.logger.log({
      event: 'http.request',
      outcome: 'ok',
      method: request.method,
      // Sem query string: parâmetro de busca pode carregar dado do paciente.
      route: request.originalUrl?.split('?')[0] ?? request.url,
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
    });
  }
}
