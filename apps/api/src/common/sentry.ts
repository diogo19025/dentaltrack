import * as Sentry from '@sentry/nestjs';
import { getContext } from './request-context';
import { redactText } from './redact';

/**
 * Captura de exceptions (P0.3).
 *
 * Sentry é opcional por desenho: sem `SENTRY_DSN` nada é inicializado e o
 * `reportException` vira no-op. Isso mantém desenvolvimento e testes sem rede e
 * sem ruído, e permite ligar o monitoramento em produção só com uma variável.
 *
 * O que **não** foi feito: `SentryModule.forRoot()` com o filtro global do
 * pacote. O projeto já tem o `AllExceptionsFilter`, que preserva os corpos de
 * erro que o front consome; trocar por outro filtro mudaria contrato de API
 * para ganhar nada. Aqui o Sentry é só o destino do erro, não o dono do fluxo.
 */

let enabled = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION,
    // Amostragem baixa: o valor aqui é o erro, não o APM. Tracing completo num
    // produto com webhook de WhatsApp gera volume alto e custo sem retorno.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // O paciente é titular de dado pessoal: nada de IP nem cabeçalho de request.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.message) event.message = redactText(event.message);
      for (const value of event.exception?.values ?? []) {
        if (value.value) value.value = redactText(value.value);
      }
      // A URL pode carregar telefone em rota de diagnóstico.
      if (event.request?.url) {
        event.request.url = redactText(event.request.url);
      }
      return event;
    },
  });
  enabled = true;
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * Envia a exceção com o contexto de correlação anexado — é o que permite pular
 * do alerta no Sentry direto para as linhas de log daquela mesma operação.
 */
export function reportException(
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!enabled) return;
  const context = getContext();
  Sentry.withScope((scope) => {
    if (context?.requestId) scope.setTag('requestId', context.requestId);
    if (context?.clinicId) scope.setTag('clinicId', context.clinicId);
    if (context?.channel) scope.setTag('channel', context.channel);
    if (context?.conversationId) {
      scope.setContext('conversa', { id: context.conversationId });
    }
    if (extra) scope.setContext('operacao', extra);
    Sentry.captureException(error);
  });
}
