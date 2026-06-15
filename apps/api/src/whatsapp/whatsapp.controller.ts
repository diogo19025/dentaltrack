import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/public.decorator';
import type { Env } from '../config/env.validation';
import type { EvolutionWebhookPayload } from './webhook.types';
import { WhatsappService } from './whatsapp.service';

/**
 * Webhook de entrada da Evolution API (WA-3). **Público** (sem JWT) — a clínica
 * é resolvida pela instância no payload (WA-1). Valida um token opcional
 * (`x-evolution-token`) e **responde 200 imediatamente**, processando em
 * background (a Evolution reentrega em caso de timeout/erro — o dedupe protege).
 */
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Body() body: EvolutionWebhookPayload,
    @Headers('x-evolution-token') token?: string,
  ): { received: true } {
    const expected = this.config.get('EVOLUTION_WEBHOOK_TOKEN', {
      infer: true,
    });
    if (expected && token !== expected) {
      throw new UnauthorizedException('Token de webhook inválido.');
    }

    // Não aguarda: o ack precisa ser rápido; handleWebhook nunca lança.
    void this.whatsapp.handleWebhook(body);
    return { received: true };
  }
}
