import { generateKeyPairSync } from 'node:crypto';
import { AgendaProviderError } from '../clinicorp/agenda-provider';
import {
  GoogleCalendarClient,
  normalizePrivateKey,
} from './google-calendar.client';

/** Chave RSA real (efêmera) — a assinatura do JWT precisa de uma que funcione. */
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const SA_EMAIL = 'agenda@projeto.iam.gserviceaccount.com';
const CALENDAR = 'clinica@group.calendar.google.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GoogleCalendarClient (transporte · F12)', () => {
  const tokenBody = { access_token: 'tok-1', expires_in: 3600 };

  function makeClient(fetchMock: jest.Mock) {
    return new GoogleCalendarClient({
      serviceAccountEmail: SA_EMAIL,
      privateKey: PEM,
      fetchImpl: fetchMock,
      now: () => new Date('2026-09-01T12:00:00.000Z'),
      // Sem espera de verdade: o que se verifica é quantas tentativas houve,
      // não quanto tempo o backoff dorme (isso é do http-retry.spec).
      retry: { sleep: () => Promise.resolve() },
    });
  }

  it('troca o JWT assinado por um access token e o usa como Bearer', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(jsonResponse({ summary: 'Agenda da Clínica' }));

    const client = makeClient(fetchMock);
    const calendar = await client.getCalendar(CALENDAR);

    expect(calendar.summary).toBe('Agenda da Clínica');

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toBe('https://oauth2.googleapis.com/token');
    expect(String(tokenInit.body)).toContain('jwt-bearer');

    const [calUrl, calInit] = fetchMock.mock.calls[1];
    expect(String(calUrl)).toContain(encodeURIComponent(CALENDAR));
    expect(calInit.headers.Authorization).toBe('Bearer tok-1');
  });

  it('reusa o token até perto de expirar — um por chamada estouraria cota', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ summary: 'Agenda' })),
      );

    const client = makeClient(fetchMock);
    await client.getCalendar(CALENDAR);
    await client.getCalendar(CALENDAR);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('oauth2'),
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it('freeBusy devolve os intervalos ocupados como datas', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(
        jsonResponse({
          calendars: {
            [CALENDAR]: {
              busy: [
                {
                  start: '2026-09-01T13:00:00Z',
                  end: '2026-09-01T14:00:00Z',
                },
              ],
            },
          },
        }),
      );

    const client = makeClient(fetchMock);
    const busy = await client.freeBusy(
      CALENDAR,
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-02T00:00:00Z'),
    );

    expect(busy).toHaveLength(1);
    expect(busy[0].start.toISOString()).toBe('2026-09-01T13:00:00.000Z');
  });

  it('listEvents segue a paginação até o fim', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: 'a' }], nextPageToken: 'p2' }),
      )
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'b' }] }));

    const client = makeClient(fetchMock);
    const events = await client.listEvents(
      CALENDAR,
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-08T00:00:00Z'),
    );

    expect(events.map((e) => e.id)).toEqual(['a', 'b']);
    const secondPage = String(fetchMock.mock.calls[2][0]);
    expect(secondPage).toContain('pageToken=p2');
  });

  it('resposta não-2xx vira AgendaProviderError com o status e o corpo', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(tokenBody))
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Not Found' } }, 404),
      );

    const client = makeClient(fetchMock);
    await expect(client.getCalendar(CALENDAR)).rejects.toThrow(
      AgendaProviderError,
    );
    await expect(
      makeClient(
        jest
          .fn()
          .mockResolvedValueOnce(jsonResponse(tokenBody))
          .mockResolvedValueOnce(jsonResponse({}, 404)),
      ).getCalendar(CALENDAR),
    ).rejects.toThrow('404');
  });

  it('recusa da service account explica a falha, sem chamar a agenda', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 400));

    const client = makeClient(fetchMock);
    await expect(client.getCalendar(CALENDAR)).rejects.toThrow(
      'service account',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('chave privada inválida falha com mensagem clara, não com stack críptico', async () => {
    const client = new GoogleCalendarClient({
      serviceAccountEmail: SA_EMAIL,
      privateKey: 'nao-e-uma-chave',
      fetchImpl: jest.fn(),
    });
    await expect(client.getCalendar(CALENDAR)).rejects.toThrow('chave privada');
  });

  describe('normalizePrivateKey — os formatos usuais de .env', () => {
    it('aceita PEM puro', () => {
      expect(normalizePrivateKey(PEM)).toBe(PEM.trim().replace(/\\n/g, '\n'));
    });

    it('aceita PEM com \\n escapado (uma linha só no .env)', () => {
      const escaped = PEM.replace(/\n/g, '\\n');
      expect(normalizePrivateKey(escaped)).toContain('BEGIN PRIVATE KEY');
      expect(normalizePrivateKey(escaped)).toContain('\n');
    });

    it('aceita o PEM inteiro em base64', () => {
      const encoded = Buffer.from(PEM, 'utf8').toString('base64');
      expect(normalizePrivateKey(encoded)).toContain('BEGIN PRIVATE KEY');
    });
  });

  describe('deleteEvent / patchEvent (P0.5)', () => {
    it('DELETE responde 204 sem corpo — e isso é sucesso', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(tokenBody))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      await expect(
        makeClient(fetchMock).deleteEvent(CALENDAR, 'evt-1'),
      ).resolves.toBeUndefined();

      const [url, init] = fetchMock.mock.calls[1];
      expect(init.method).toBe('DELETE');
      expect(String(url)).toContain('/events/evt-1');
    });

    it.each([404, 410])(
      'evento que já não existe (%i) conta como apagado — cancelar é idempotente',
      async (status) => {
        const fetchMock = jest
          .fn()
          .mockResolvedValueOnce(jsonResponse(tokenBody))
          .mockResolvedValueOnce(new Response('gone', { status }));

        await expect(
          makeClient(fetchMock).deleteEvent(CALENDAR, 'evt-1'),
        ).resolves.toBeUndefined();
      },
    );

    it('outros erros no DELETE sobem como AgendaProviderError', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(tokenBody))
        .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

      await expect(
        makeClient(fetchMock).deleteEvent(CALENDAR, 'evt-1'),
      ).rejects.toBeInstanceOf(AgendaProviderError);
    });

    it('PATCH manda só o que muda e devolve o evento', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(tokenBody))
        .mockResolvedValueOnce(
          jsonResponse({ id: 'evt-1', status: 'confirmed' }),
        );

      const event = await makeClient(fetchMock).patchEvent(CALENDAR, 'evt-1', {
        start: { dateTime: '2026-09-04T14:00:00.000Z' },
      });

      expect(event.id).toBe('evt-1');
      const [, init] = fetchMock.mock.calls[1];
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(String(init.body))).toEqual({
        start: { dateTime: '2026-09-04T14:00:00.000Z' },
      });
    });
  });

  /**
   * A categoria da falha (P0.1) é o que faz a tela dizer "revise a credencial"
   * em vez de repetir o código HTTP, e o que decide o que pode ser repetido.
   */
  describe('categoria da falha (P0.1)', () => {
    async function kindOf(response: Response): Promise<string> {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(tokenBody))
        .mockResolvedValue(response);
      try {
        await makeClient(fetchMock).getCalendar(CALENDAR);
        throw new Error('deveria ter falhado');
      } catch (err) {
        expect(err).toBeInstanceOf(AgendaProviderError);
        return (err as AgendaProviderError).kind;
      }
    }

    it.each([
      [401, 'auth'],
      [403, 'auth'],
      [404, 'config'],
      [429, 'indisponivel'],
      [500, 'indisponivel'],
      [503, 'indisponivel'],
    ])('HTTP %i → %s', async (status, expected) => {
      expect(await kindOf(new Response('erro', { status }))).toBe(expected);
    });

    it('200 com HTML no corpo → resposta_invalida, não SyntaxError cru', async () => {
      const html = new Response('<html>portal cativo</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
      expect(await kindOf(html)).toBe('resposta_invalida');
    });

    it('abort do timeout → timeout', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(tokenBody))
        .mockImplementation((_url: URL, init: RequestInit) =>
          Promise.reject(
            Object.assign(new Error('aborted'), {
              name: 'AbortError',
              signal: init.signal,
            }),
          ),
        );
      // O client decide pelo `signal.aborted`, então o teste precisa abortá-lo.
      const client = new GoogleCalendarClient({
        serviceAccountEmail: SA_EMAIL,
        privateKey: PEM,
        fetchImpl: fetchMock,
        timeoutMs: 1,
        now: () => new Date('2026-09-01T12:00:00.000Z'),
        retry: { sleep: () => Promise.resolve() },
      });

      await expect(client.getCalendar(CALENDAR)).rejects.toMatchObject({
        kind: expect.stringMatching(/timeout|indisponivel/),
      });
    });

    it('falha de rede → indisponivel', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(tokenBody))
        .mockRejectedValue(new TypeError('fetch failed'));

      await expect(
        makeClient(fetchMock).getCalendar(CALENDAR),
      ).rejects.toMatchObject({ kind: 'indisponivel' });
    });

    it('credencial recusada no endpoint de token → auth', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400));

      await expect(
        makeClient(fetchMock).getCalendar(CALENDAR),
      ).rejects.toMatchObject({ kind: 'auth' });
    });
  });

  /**
   * Repetir leitura recupera instabilidade; repetir escrita cria duplicata.
   * A distinção é do chamador, não do verbo — `freeBusy` é `POST` e é leitura.
   */
  describe('retry (P0.1)', () => {
    it('leitura instável é repetida e acaba dando certo', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(tokenBody))
        .mockResolvedValueOnce(new Response('boom', { status: 503 }))
        .mockResolvedValueOnce(jsonResponse({ summary: 'Agenda' }));

      const calendar = await makeClient(fetchMock).getCalendar(CALENDAR);

      expect(calendar.summary).toBe('Agenda');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('credencial recusada não é repetida — insistir só multiplica a recusa', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(tokenBody))
        .mockResolvedValue(new Response('nope', { status: 401 }));

      await expect(makeClient(fetchMock).getCalendar(CALENDAR)).rejects.toThrow(
        '401',
      );

      // Token + uma única tentativa da rota.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('criar evento NÃO é repetido — é assim que se duplica um agendamento', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse(tokenBody))
        .mockResolvedValue(new Response('boom', { status: 503 }));

      await expect(
        makeClient(fetchMock).createEvent(CALENDAR, { summary: 'x' }),
      ).rejects.toThrow('503');

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
