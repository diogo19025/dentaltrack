import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import type { EvolutionWebhookPayload } from './webhook.types';
import { WhatsappController } from './whatsapp.controller';
import type { WhatsappService } from './whatsapp.service';

describe('WhatsappController (webhook público da Evolution)', () => {
  const env: Record<string, string | undefined> = {};
  const config = {
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService<Env, true>;
  const whatsapp = { handleWebhook: jest.fn().mockResolvedValue(undefined) };
  const controller = new WhatsappController(
    whatsapp as unknown as WhatsappService,
    config,
  );
  const body = { event: 'messages.upsert' } as EvolutionWebhookPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(env)) delete env[key];
  });

  it('token certo: aceita e processa em background', () => {
    env.EVOLUTION_WEBHOOK_TOKEN = 'segredo-do-webhook';

    expect(controller.webhook(body, 'segredo-do-webhook')).toEqual({
      received: true,
    });
    expect(whatsapp.handleWebhook).toHaveBeenCalledWith(body);
  });

  it.each([undefined, '', 'segredo-errado', 'segredo-do-webhook-e-mais'])(
    'token %p: 401 sem processar',
    (token) => {
      env.EVOLUTION_WEBHOOK_TOKEN = 'segredo-do-webhook';

      expect(() => controller.webhook(body, token)).toThrow(
        UnauthorizedException,
      );
      expect(whatsapp.handleWebhook).not.toHaveBeenCalled();
    },
  );

  it('produção sem token configurado: falha fechada', () => {
    env.NODE_ENV = 'production';

    expect(() => controller.webhook(body, 'qualquer')).toThrow(
      UnauthorizedException,
    );
    expect(whatsapp.handleWebhook).not.toHaveBeenCalled();
  });

  it('desenvolvimento sem token configurado: segue aceitando', () => {
    env.NODE_ENV = 'development';

    controller.webhook(body, undefined);

    expect(whatsapp.handleWebhook).toHaveBeenCalled();
  });
});
