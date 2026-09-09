import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getContext } from './request-context';
import { reportException } from './sentry';

/**
 * Filtro global de exceções (P0.3).
 *
 * Antes dele, uma exceção não-HTTP virava um 500 genérico do Nest, sem log com
 * stack e sem nada que ligasse o erro visto pelo usuário ao servidor. Aqui todo
 * erro sai com o `requestId` no corpo — é o que o suporte pede ao cliente e usa
 * para achar as linhas de log da operação.
 *
 * Duas invariantes que o filtro respeita de propósito:
 *
 * - **O corpo dos erros HTTP não muda.** `NotFoundException`, as mensagens de
 *   validação do `nestjs-zod` e os erros que o front já parseia continuam
 *   idênticos, só com um campo a mais. Filtro de erro não é lugar de mudar
 *   contrato de API.
 * - **Nada é escrito depois que a resposta começou.** O `POST /chat` responde
 *   por SSE; escrever um JSON no meio do stream corromperia a resposta.
 */
/**
 * Fronteira entre "o cliente errou" e "nós erramos". Número puro em vez de
 * `HttpStatus.INTERNAL_SERVER_ERROR` porque `getStatus()` devolve `number`, e
 * comparar `number` com enum é justamente o que o lint proíbe.
 */
const SERVER_ERROR = 500;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logUnexpected(exception, null);
      return;
    }

    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = getContext()?.requestId;
    const route = routeOf(request);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // 4xx é o cliente errando (validação, 404, 403) — ruído em nível de erro.
      // 5xx é o servidor errando, e isso precisa acordar alguém.
      if (status >= SERVER_ERROR) {
        this.logger.error({
          event: 'http.error',
          outcome: 'fail',
          status,
          route,
          reason: exception.message,
        });
        reportException(exception, { status, route });
      } else {
        this.logger.warn({
          event: 'http.rejected',
          outcome: 'fail',
          status,
          route,
          reason: exception.message,
        });
      }

      this.send(response, status, withRequestId(body, status, requestId));
      return;
    }

    this.logUnexpected(exception, route);
    reportException(exception, { route });
    this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        'Erro interno. Se o problema persistir, informe o código abaixo.',
      requestId,
    });
  }

  private logUnexpected(exception: unknown, route: string | null): void {
    const error = exception instanceof Error ? exception : null;
    this.logger.error(
      {
        event: 'http.unhandled',
        outcome: 'fail',
        ...(route ? { route } : {}),
        reason: error?.message ?? String(exception),
      },
      error?.stack,
    );
  }

  private send(response: Response, status: number, body: unknown): void {
    if (response.headersSent) return;
    response.status(status).json(body);
  }
}

/**
 * Acrescenta o `requestId` preservando o corpo original. Corpo em string (o que
 * o Nest produz para `new BadRequestException('texto')`) é normalizado para o
 * mesmo formato de objeto, que é o que o front já sabe ler.
 */
function withRequestId(
  body: unknown,
  status: number,
  requestId: string | undefined,
): unknown {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>), requestId };
  }
  return { statusCode: status, message: body, requestId };
}

/** Rota sem query string: parâmetro de busca pode carregar dado do paciente. */
function routeOf(request: Request): string {
  const path = request.originalUrl?.split('?')[0] ?? request.url ?? '';
  return `${request.method} ${path}`;
}
