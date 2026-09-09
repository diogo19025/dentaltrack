import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './common/request-id.middleware';
import { initSentry, isSentryEnabled } from './common/sentry';
import { StructuredLogger } from './common/structured-logger';

async function bootstrap(): Promise<void> {
  // Antes de qualquer módulo: o Sentry precisa instrumentar o processo cedo, e
  // uma falha no próprio boot é justamente a que mais interessa capturar.
  initSentry();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Logger estruturado (P0.3): JSON em produção, legível em desenvolvimento.
    logger: new StructuredLogger(),
  });

  // Correlação por request. Primeiro middleware da cadeia — tudo que rodar
  // depois (guards, controllers, serviços) já enxerga o requestId.
  app.use(requestIdMiddleware);

  // O áudio do chat sobe como base64 no JSON do POST /chat — o limite default
  // (100kb) não comporta. Registrar aqui substitui o parser default do Nest.
  app.useBodyParser('json', { limit: '16mb' });

  // Validação Zod global (DTOs criados com createZodDto).
  app.useGlobalPipes(new ZodValidationPipe());

  // CORS para o frontend Next.js.
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
    // Expõe o conversationId e a transcrição do áudio (cross-origin) — o
    // transporte do useChat lê esses headers. O request id é exposto para que a
    // tela possa mostrar o código de uma falha ao usuário.
    exposedHeaders: ['X-Conversation-Id', 'X-Transcript', REQUEST_ID_HEADER],
    allowedHeaders: ['Content-Type', 'Authorization', REQUEST_ID_HEADER],
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  new Logger('Bootstrap').log(
    `API em http://localhost:${port} · monitoramento ${isSentryEnabled() ? 'ativo' : 'desligado'}`,
  );
}

void bootstrap();
