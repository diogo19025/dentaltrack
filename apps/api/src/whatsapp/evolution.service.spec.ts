import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { EvolutionService } from './evolution.service';

/** ConfigService mínimo com a Evolution configurada. */
function makeConfig(): ConfigService<Env, true> {
  const values: Record<string, string> = {
    EVOLUTION_API_URL: 'http://evo.local',
    EVOLUTION_API_KEY: 'k',
  };
  return {
    get: (k: string) => values[k],
  } as unknown as ConfigService<Env, true>;
}

/** Resposta `findMessages` com um único registro carregando o `@lid`. */
function findMessagesOk(lid: string) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({ messages: { records: [{ key: { remoteJid: lid } }] } }),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

/** Resposta genérica 200 OK com corpo vazio (rotas de envio). */
function okEmpty() {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(undefined),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

describe('EvolutionService.sendMedia', () => {
  let service: EvolutionService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new EvolutionService(makeConfig());
    fetchMock = jest.fn().mockResolvedValue(okEmpty());
    global.fetch = fetchMock;
  });

  it('imagem/vídeo/documento: usa /message/sendMedia com o mediatype e a URL', async () => {
    await service.sendMedia('dentaltrack', '5511999', {
      url: 'https://cdn/catalogo.pdf',
      type: 'document',
      caption: 'Nosso catálogo',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://evo.local/message/sendMedia/dentaltrack');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      number: '5511999',
      mediatype: 'document',
      media: 'https://cdn/catalogo.pdf',
      caption: 'Nosso catálogo',
    });
    expect(typeof body.delay).toBe('number');
  });

  it('áudio: usa o endpoint dedicado /message/sendWhatsAppAudio (mensagem de voz)', async () => {
    await service.sendMedia('dentaltrack', '5511999', {
      url: 'https://cdn/audio.mp3',
      type: 'audio',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://evo.local/message/sendWhatsAppAudio/dentaltrack');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      number: '5511999',
      audio: 'https://cdn/audio.mp3',
    });
    expect(body.mediatype).toBeUndefined();
  });
});

describe('EvolutionService.resolveLidJid', () => {
  let service: EvolutionService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new EvolutionService(makeConfig());
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('com messageId: filtra por key.id (correto por construção) e devolve o @lid', async () => {
    fetchMock.mockResolvedValueOnce(findMessagesOk('143722591289599@lid'));

    const lid = await service.resolveLidJid(
      'dentaltrack',
      '5583@s.whatsapp.net',
      'MSG-42',
    );

    expect(lid).toBe('143722591289599@lid');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://evo.local/chat/findMessages/dentaltrack');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      where: { key: { id: 'MSG-42' } },
      limit: 1,
    });
  });

  it('sem messageId: filtra por remoteJidAlt (envio proativo, ex.: lembrete)', async () => {
    fetchMock.mockResolvedValueOnce(findMessagesOk('143722591289599@lid'));

    const lid = await service.resolveLidJid(
      'dentaltrack',
      '5583@s.whatsapp.net',
    );

    expect(lid).toBe('143722591289599@lid');
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.where).toEqual({
      key: { remoteJidAlt: '5583@s.whatsapp.net' },
    });
  });

  it('cacheia por telefone (LID é estável): 2ª chamada não refaz o fetch', async () => {
    fetchMock.mockResolvedValueOnce(findMessagesOk('143722591289599@lid'));

    await service.resolveLidJid('dentaltrack', '5583@s.whatsapp.net', 'M1');
    const again = await service.resolveLidJid(
      'dentaltrack',
      '5583@s.whatsapp.net',
      'M2',
    );

    expect(again).toBe('143722591289599@lid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sem @lid nos registros: devolve null (chamador cai p/ o telefone)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ messages: { records: [] } }),
      text: () => Promise.resolve(''),
    });

    expect(
      await service.resolveLidJid('dentaltrack', '5583@s.whatsapp.net', 'M'),
    ).toBeNull();
  });

  it('erro na Evolution: não propaga, devolve null', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('boom'),
    });

    expect(
      await service.resolveLidJid('dentaltrack', '5583@s.whatsapp.net', 'M'),
    ).toBeNull();
  });
});
