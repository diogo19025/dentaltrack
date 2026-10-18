import {
  parseMetaInbound,
  type MetaWebhookPayload,
} from './meta-webhook.types';

function payload(
  messages: unknown[],
  over: Partial<MetaWebhookPayload> = {},
): MetaWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: '1055' },
              contacts: [{ wa_id: '5511999998888', profile: { name: 'João' } }],
              messages: messages as never,
            },
          },
        ],
      },
    ],
    ...over,
  };
}

describe('parseMetaInbound', () => {
  it('texto: número que recebeu, telefone, nome e id da mensagem', () => {
    const [m] = parseMetaInbound(
      payload([
        {
          id: 'wamid.1',
          from: '5511999998888',
          type: 'text',
          text: { body: ' Quero agendar ' },
        },
      ]),
    );
    expect(m).toMatchObject({
      provider: 'meta',
      instance: '1055',
      messageId: 'wamid.1',
      phone: '5511999998888',
      pushName: 'João',
      text: 'Quero agendar',
    });
  });

  it('áudio: guarda o id da mídia para baixar depois', () => {
    const [m] = parseMetaInbound(
      payload([
        {
          id: 'wamid.2',
          from: '5511999998888',
          type: 'audio',
          audio: { id: 'MEDIA1', mime_type: 'audio/ogg; codecs=opus' },
        },
      ]),
    );
    expect(m.audio).toEqual({ mimeType: 'audio/ogg', ref: 'MEDIA1' });
  });

  it('ignora tipos não suportados, payload sem mensagens e outros produtos', () => {
    expect(
      parseMetaInbound(payload([{ id: 'w', from: '55', type: 'image' }])),
    ).toEqual([]);
    expect(parseMetaInbound(payload([]))).toEqual([]);
    expect(parseMetaInbound({ object: 'instagram' })).toEqual([]);
  });

  it('um POST com várias mensagens devolve todas', () => {
    const out = parseMetaInbound(
      payload([
        { id: 'a', from: '5511999998888', type: 'text', text: { body: 'oi' } },
        {
          id: 'b',
          from: '5511999998888',
          type: 'text',
          text: { body: 'tudo bem?' },
        },
      ]),
    );
    expect(out.map((m) => m.messageId)).toEqual(['a', 'b']);
  });
});
