import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { MetaWebhookController } from './meta-webhook.controller';

const SECRET = 'app-secret';
const body = { object: 'whatsapp_business_account', entry: [] };
const raw = Buffer.from(JSON.stringify(body));
const sign = (buf: Buffer, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(buf).digest('hex')}`;

function build(
  env: Record<string, string | undefined> = {
    META_APP_SECRET: SECRET,
    META_WEBHOOK_VERIFY_TOKEN: 'verify',
  },
) {
  const whatsapp = {
    handleMetaWebhook: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: (k: string) => env[k] };
  const controller = new MetaWebhookController(
    whatsapp as never,
    config as never,
  );
  const req = (rawBody: Buffer | undefined) => ({ rawBody, body }) as never;
  return { controller, whatsapp, req };
}

describe('MetaWebhookController', () => {
  it('verificação: devolve o challenge só com o token certo', () => {
    const { controller } = build();
    expect(controller.verify('subscribe', 'verify', '123')).toBe('123');
    expect(() => controller.verify('subscribe', 'errado', '123')).toThrow(
      ForbiddenException,
    );
    expect(() => controller.verify('unsubscribe', 'verify', '123')).toThrow(
      ForbiddenException,
    );
  });

  it('verificação sem token configurado recusa tudo', () => {
    const { controller } = build({});
    expect(() => controller.verify('subscribe', 'verify', '123')).toThrow(
      ForbiddenException,
    );
  });

  it('assinatura válida: confirma e processa', () => {
    const { controller, whatsapp, req } = build();
    expect(controller.webhook(req(raw), sign(raw))).toEqual({ received: true });
    expect(whatsapp.handleMetaWebhook).toHaveBeenCalledWith(body);
  });

  it('assinatura inválida, de outro corpo ou ausente: 401 e nada é processado', () => {
    const { controller, whatsapp, req } = build();
    expect(() => controller.webhook(req(raw), sign(raw, 'outro'))).toThrow(
      UnauthorizedException,
    );
    expect(() => controller.webhook(req(raw), sign(Buffer.from('{}')))).toThrow(
      UnauthorizedException,
    );
    expect(() => controller.webhook(req(raw), undefined)).toThrow(
      UnauthorizedException,
    );
    expect(() => controller.webhook(req(undefined), sign(raw))).toThrow(
      UnauthorizedException,
    );
    expect(whatsapp.handleMetaWebhook).not.toHaveBeenCalled();
  });

  it('sem META_APP_SECRET recusa mesmo com assinatura de qualquer coisa', () => {
    const { controller, req } = build({});
    expect(() => controller.webhook(req(raw), sign(raw))).toThrow(
      UnauthorizedException,
    );
  });
});
