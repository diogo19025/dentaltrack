import { parseInboundMessage } from './webhook.types';

const JID = '5511999998888@s.whatsapp.net';

function payload(over: Record<string, unknown> = {}) {
  return {
    event: 'messages.upsert',
    instance: 'dentaltrack',
    data: {
      key: { remoteJid: JID, fromMe: false, id: 'MSG1' },
      pushName: 'João',
      message: { conversation: 'Olá' },
      ...over,
    },
  };
}

describe('parseInboundMessage', () => {
  it('extrai texto de uma mensagem individual (conversation)', () => {
    const res = parseInboundMessage(payload());
    expect(res).toEqual({
      instance: 'dentaltrack',
      messageId: 'MSG1',
      phone: '5511999998888',
      remoteJid: JID,
      pushName: 'João',
      text: 'Olá',
    });
  });

  it('captura addressingMode:"lid" (sinal p/ responder ao JID @lid)', () => {
    const res = parseInboundMessage(
      payload({
        key: {
          remoteJid: JID,
          remoteJidAlt: JID,
          addressingMode: 'lid',
          fromMe: false,
          id: 'MSG1',
        },
      }),
    );
    expect(res?.addressingMode).toBe('lid');
    expect(res?.phone).toBe('5511999998888');
  });

  it('extrai texto de extendedTextMessage e faz trim', () => {
    const res = parseInboundMessage(
      payload({
        message: { extendedTextMessage: { text: '  oi tudo bem  ' } },
      }),
    );
    expect(res?.text).toBe('oi tudo bem');
  });

  it('normaliza o nome do evento (MESSAGES_UPSERT)', () => {
    const p = { ...payload(), event: 'MESSAGES_UPSERT' };
    expect(parseInboundMessage(p)?.text).toBe('Olá');
  });

  it('ignora eventos que não são messages.upsert', () => {
    expect(
      parseInboundMessage({ ...payload(), event: 'messages.update' }),
    ).toBeNull();
  });

  it('ignora a própria mensagem (fromMe)', () => {
    const p = payload({ key: { remoteJid: JID, fromMe: true, id: 'MSG1' } });
    expect(parseInboundMessage(p)).toBeNull();
  });

  it('ignora grupos (@g.us) e status', () => {
    expect(
      parseInboundMessage(
        payload({ key: { remoteJid: '123@g.us', fromMe: false, id: 'G1' } }),
      ),
    ).toBeNull();
    expect(
      parseInboundMessage(
        payload({
          key: { remoteJid: 'status@broadcast', fromMe: false, id: 'S1' },
        }),
      ),
    ).toBeNull();
  });

  it('parseia áudio (PTT) com base64 do webhook e mimetype normalizado', () => {
    const res = parseInboundMessage(
      payload({
        messageType: 'audioMessage',
        message: {
          audioMessage: { mimetype: 'audio/ogg; codecs=opus' },
          base64: 'BASE64DATA',
        },
      }),
    );
    expect(res?.text).toBeUndefined();
    expect(res?.audio).toMatchObject({
      base64: 'BASE64DATA',
      mimeType: 'audio/ogg',
    });
    expect(res?.audio?.key).toEqual({
      remoteJid: JID,
      fromMe: false,
      id: 'MSG1',
    });
  });

  it('áudio sem base64 ainda é reconhecido (será buscado depois)', () => {
    const res = parseInboundMessage(
      payload({
        messageType: 'audioMessage',
        message: { audioMessage: { mimetype: 'audio/ogg' } },
      }),
    );
    expect(res?.audio?.base64).toBeUndefined();
    expect(res?.audio?.mimeType).toBe('audio/ogg');
  });

  it('ignora tipos não suportados (sem texto nem áudio)', () => {
    const res = parseInboundMessage(
      payload({ messageType: 'imageMessage', message: { imageMessage: {} } }),
    );
    expect(res).toBeNull();
  });

  it('ignora payload sem instância/jid/id', () => {
    expect(parseInboundMessage({ event: 'messages.upsert' })).toBeNull();
    expect(
      parseInboundMessage({
        event: 'messages.upsert',
        instance: 'x',
        data: { key: { remoteJid: JID } },
      }),
    ).toBeNull();
  });
});
