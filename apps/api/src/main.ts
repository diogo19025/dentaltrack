import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Validação Zod global (DTOs criados com createZodDto).
  app.useGlobalPipes(new ZodValidationPipe());

  // CORS para o frontend Next.js.
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
    // Expõe o conversationId ao cliente (cross-origin) — o useChat lê esse header.
    exposedHeaders: ['X-Conversation-Id'],
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  new Logger('Bootstrap').log(`API DentalTrack em http://localhost:${port}`);
}

void bootstrap();
