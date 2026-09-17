import { AgendaProviderError } from './agenda-provider';
import {
  ClinicorpClient,
  CLINICORP_ROUTES,
  classifyFailure,
} from './clinicorp.client';

/**
 * Transporte do Clinicorp contra `fetch` stubado (P0.1) — nenhum teste deste
 * repositório toca a rede, e é isso que permite exercitar credencial recusada,
 * API fora do ar e resposta ilegível sem a credencial do cliente existir.
 */
function makeClient(fetchMock: jest.Mock) {
  return new ClinicorpClient({
    username: 'api-user',
    token: 'segredo',
    subscriberId: 'sub-1',
    fetchImpl: fetchMock,
    // Sem espera de verdade — o que interessa é o número de tentativas.
    retry: { sleep: () => Promise.resolve() },
  });
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('ClinicorpClient (transporte · F9)', () => {
  it('autentica com Basic e injeta o subscriber_id na query', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ units: [] }));

    await makeClient(fetchMock).get(CLINICORP_ROUTES.units, { page: 1 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('subscriber_id=sub-1');
    expect(String(url)).toContain('page=1');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('api-user:segredo', 'utf8').toString('base64')}`,
    );
  });

  it('corpo vazio é sucesso sem conteúdo, não erro de parsing', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 200 }));

    await expect(makeClient(fetchMock).get('/x')).resolves.toBeUndefined();
  });

  describe('categoria da falha (P0.1)', () => {
    it.each([
      [401, 'auth'],
      [403, 'auth'],
      [404, 'config'],
      [429, 'indisponivel'],
      [500, 'indisponivel'],
    ])('HTTP %i → %s', async (status, expected) => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(new Response('erro', { status }));

      await expect(makeClient(fetchMock).get('/x')).rejects.toMatchObject({
        kind: expected,
        status,
      });
    });

    it('corpo que não é JSON → resposta_invalida', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(new Response('<html>login</html>', { status: 200 }));

      await expect(makeClient(fetchMock).get('/x')).rejects.toMatchObject({
        kind: 'resposta_invalida',
      });
    });

    it('timeout → timeout', async () => {
      const fetchMock = jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('aborted'), { name: 'AbortError' }),
        );

      await expect(makeClient(fetchMock).get('/x')).rejects.toMatchObject({
        kind: 'timeout',
      });
    });

    it('falha de rede → indisponivel', async () => {
      const fetchMock = jest
        .fn()
        .mockRejectedValue(new TypeError('ECONNREFUSED'));

      const err = await makeClient(fetchMock)
        .get('/x')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AgendaProviderError);
      expect((err as AgendaProviderError).kind).toBe('indisponivel');
    });

    /**
     * O 404 guardado como `status` é o que sustenta a idempotência do
     * cancelamento: o provider trata "não existe lá" como sucesso, e antes
     * disso essa decisão dependia de achar "respondeu 404" no texto do erro.
     */
    it('o status HTTP fica acessível, não só na mensagem', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(new Response('não existe', { status: 404 }));

      await expect(
        makeClient(fetchMock).post(CLINICORP_ROUTES.cancelAppointment, {}),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('retry (P0.1)', () => {
    it('leitura instável é repetida', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(new Response('boom', { status: 502 }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      await expect(makeClient(fetchMock).get('/x')).resolves.toEqual({
        ok: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('credencial recusada não é repetida', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(new Response('nope', { status: 401 }));

      await expect(makeClient(fetchMock).get('/x')).rejects.toThrow('401');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    /**
     * A regra que protege a agenda do cliente: `create_appointment_by_api` não
     * é idempotente, e um retry cego marcaria a mesma consulta duas vezes.
     */
    it('escrita NUNCA é repetida, nem quando a falha é transitória', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(new Response('boom', { status: 503 }));

      await expect(
        makeClient(fetchMock).post(CLINICORP_ROUTES.createAppointment, {
          Name: 'Ana',
        }),
      ).rejects.toThrow('503');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('classifyFailure (visto ao vivo em 2026-09-17)', () => {
    it('400 "horário ocupado" é conflito, não falha desconhecida', () => {
      expect(
        classifyFailure(
          400,
          '{"Error":400,"Message":"O horário solicitado encontra-se ocupado"}',
        ),
      ).toBe('conflito');
      expect(classifyFailure(400, 'campo inválido')).toBe('desconhecido');
      expect(classifyFailure(401, '')).toBe('auth');
    });
  });
});
