import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/public.decorator';
import type { Env } from '../config/env.validation';
import type { EvolutionWebhookPayload } from './webhook.types';
import { WhatsappService } from './whatsapp.service';

/**
 * Webhook de entrada da Evolution API (WA-3). **Público** (sem JWT) — a empresa
 * é resolvida pela instância no payload (WA-1). Exige o token
 * (`x-evolution-token`) em produção e **responde 200 imediatamente**,
 * processando em background (a Evolution reentrega em caso de timeout/erro —
 * o dedupe protege).
 */
@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

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
    this.authorize(token);

    // Não aguarda: o ack precisa ser rápido; handleWebhook nunca lança.
    void this.whatsapp.handleWebhook(body);
    return { received: true };
  }

  /**
   * O token é o que separa a Evolution de qualquer pessoa na internet: sem ele,
   * um POST com o nome da instância faz o bot atender um telefone inventado —
   * desmarcar a consulta de alguém, escrever para terceiros pelo número da
   * empresa, gastar IA. Por isso produção **falha fechada** quando o token não
   * está configurado; em desenvolvimento ele segue opcional, porque a Evolution
   * local roda na mesma máquina.
   */
  private authorize(token: string | undefined): void {
    const expected = this.config.get('EVOLUTION_WEBHOOK_TOKEN', {
      infer: true,
    });
    if (!expected) {
      if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
        this.logger.error(
          'Webhook do WhatsApp recusado: EVOLUTION_WEBHOOK_TOKEN não está configurada em produção.',
        );
        throw new UnauthorizedException('Webhook sem token configurado.');
      }
      return;
    }
    if (!token || !sameSecret(token, expected)) {
      throw new UnauthorizedException('Token de webhook inválido.');
    }
  }
}

/**
 * Comparação em tempo constante. O hash iguala os tamanhos, que o
 * `timingSafeEqual` exige, sem vazar o tamanho do segredo.
 */
function sameSecret(received: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}
