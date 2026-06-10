import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
    // transporte do useChat lê esses headers.
    exposedHeaders: ['X-Conversation-Id', 'X-Transcript'],
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  new Logger('Bootstrap').log(`API DentalTrack em http://localhost:${port}`);
}

void bootstrap();
