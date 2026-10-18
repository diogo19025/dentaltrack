import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  type RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import type { Env } from '../config/env.validation';
import type { MetaWebhookPayload } from './meta-webhook.types';
import { WhatsappService } from './whatsapp.service';

/**
 * Webhook da Cloud API da Meta. **Público** (sem JWT): a empresa é resolvida
 * pelo `phone_number_id` do payload. Duas proteções, ambas fechadas por padrão:
 * - GET (verificação do cadastro do webhook) exige o `META_WEBHOOK_VERIFY_TOKEN`;
 * - POST exige a assinatura `X-Hub-Signature-256`, HMAC-SHA256 do **corpo
 *   bruto** com o `META_APP_SECRET`. Sem a assinatura, qualquer um na internet
 *   poderia postar com o ID de um número e fazer o bot atender um telefone
 *   inventado, em qualquer ambiente. Por isso, ao contrário do token da
 *   Evolution, aqui a falta do segredo recusa tudo também em desenvolvimento.
 *
 * Responde 200 de imediato e processa em segundo plano: a Meta reentrega o que
 * não recebe 200, e a dedupe por `wamid` protege.
 */
@Controller('whatsapp/meta')
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @SkipThrottle()
  @Get('webhook')
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const expected = this.config.get('META_WEBHOOK_VERIFY_TOKEN', {
      infer: true,
    });
    if (
      !expected ||
      mode !== 'subscribe' ||
      !token ||
      !sameSecret(token, expected) ||
      !challenge
    ) {
      throw new ForbiddenException('Verificação do webhook recusada.');
    }
    return challenge;
  }

  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature?: string,
  ): { received: true } {
    this.authorize(req.rawBody, signature);
    // handleMetaWebhook nunca lança; o ack não espera o processamento.
    void this.whatsapp.handleMetaWebhook(req.body as MetaWebhookPayload);
    return { received: true };
  }

  private authorize(rawBody: Buffer | undefined, signature?: string): void {
    const secret = this.config.get('META_APP_SECRET', { infer: true });
    if (!secret) {
      this.logger.error(
        'Webhook da Meta recusado: META_APP_SECRET não está configurada.',
      );
      throw new UnauthorizedException('Webhook sem segredo configurado.');
    }
    if (!rawBody || !signature?.startsWith('sha256=')) {
      throw new UnauthorizedException('Assinatura ausente.');
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const received = Buffer.from(signature.slice('sha256='.length), 'hex');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException('Assinatura inválida.');
    }
  }
}

function sameSecret(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
