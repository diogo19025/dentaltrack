import { MetaRequestError, MetaTransport } from './meta.transport';

function fetchMock(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = jest.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { body: {} };
    return Promise.resolve({
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: () => Promise.resolve(next.body),
      arrayBuffer: () => Promise.resolve(Buffer.from('audio-bytes')),
    } as unknown as Response);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const auth = (init: RequestInit) =>
  (init.headers as Record<string, string>).Authorization;

describe('MetaTransport', () => {
  it('texto: POST no número da empresa, com o token e o corpo da Cloud API', async () => {
    const { impl, calls } = fetchMock([{ body: { messages: [{ id: 'w1' }] } }]);
    const transport = new MetaTransport('1055', 'tok', 'v21.0', impl);

    const to = await transport.resolveAddress({ phone: '5511999998888' });
    await transport.sendText(to, 'Olá');

    expect(calls[0].url).toBe('https://graph.facebook.com/v21.0/1055/messages');
    expect(auth(calls[0].init)).toBe('Bearer tok');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5511999998888',
      type: 'text',
      text: { body: 'Olá' },
    });
  });

  it('erro da Meta chega com o código: fora da janela de 24h é reconhecível', async () => {
    const { impl } = fetchMock([
      {
        status: 400,
        body: { error: { message: 'Re-engagement message', code: 131047 } },
      },
    ]);
    const transport = new MetaTransport('1055', 'tok', 'v21.0', impl);

    const err = await transport.sendText('5511999998888', 'x').catch((e) => e);

    expect(err).toBeInstanceOf(MetaRequestError);
    expect(err.code).toBe(131047);
  });

  it('escrita nunca é repetida: uma falha, uma chamada', async () => {
    const { impl } = fetchMock([
      { status: 500, body: { error: { message: 'boom' } } },
    ]);
    const transport = new MetaTransport('1055', 'tok', 'v21.0', impl);

    await expect(transport.sendText('5511999998888', 'x')).rejects.toThrow(
      'boom',
    );
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('mídia: cada tipo vai no campo certo, com legenda quando há', async () => {
    const { impl, calls } = fetchMock([{}, {}, {}, {}]);
    const transport = new MetaTransport('1055', 'tok', 'v21.0', impl);
    const to = '5511999998888';

    await transport.sendMedia(to, {
      type: 'image',
      url: 'https://x/i.png',
      caption: 'oi',
    });
    await transport.sendMedia(to, { type: 'audio', url: 'https://x/a.ogg' });
    await transport.sendMedia(to, { type: 'video', url: 'https://x/v.mp4' });
    await transport.sendMedia(to, {
      type: 'catalog' as never,
      url: 'https://x/c.pdf',
    });

    const bodies = calls.map((c) => JSON.parse(c.init.body as string));
    expect(bodies[0]).toMatchObject({
      type: 'image',
      image: { link: 'https://x/i.png', caption: 'oi' },
    });
    expect(bodies[1]).toMatchObject({
      type: 'audio',
      audio: { link: 'https://x/a.ogg' },
    });
    expect(bodies[2]).toMatchObject({ type: 'video' });
    expect(bodies[3]).toMatchObject({
      type: 'document',
      document: { link: 'https://x/c.pdf' },
    });
  });

  it('áudio recebido: resolve a URL da mídia e baixa com o mesmo token', async () => {
    const { impl, calls } = fetchMock([
      { body: { url: 'https://lookaside/audio' } },
      {},
    ]);
    const transport = new MetaTransport('1055', 'tok', 'v21.0', impl);

    const base64 = await transport.fetchInboundAudio({ ref: 'MEDIA1' });

    expect(base64).toBe(Buffer.from('audio-bytes').toString('base64'));
    expect(calls[0].url).toContain('/MEDIA1');
    expect(auth(calls[1].init)).toBe('Bearer tok');
  });

  it('áudio que a Meta não entrega: undefined, sem lançar', async () => {
    const { impl } = fetchMock([
      { status: 404, body: { error: { message: 'gone' } } },
    ]);
    const transport = new MetaTransport('1055', 'tok', 'v21.0', impl);

    expect(
      await transport.fetchInboundAudio({ ref: 'MEDIA1' }),
    ).toBeUndefined();
  });
});
