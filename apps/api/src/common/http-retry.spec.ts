import { withRetry } from './http-retry';

/** Nenhuma espera real — o teste injeta o relógio e o sorteio. */
function options(over: Partial<Parameters<typeof withRetry>[1]> = {}) {
  return {
    isRetryable: () => true,
    sleep: jest.fn().mockResolvedValue(undefined),
    // Sorteio fixo: o jitter deixa de ser aleatório e a espera vira verificável.
    random: () => 0,
    ...over,
  };
}

describe('withRetry (P0.1)', () => {
  it('sucesso de primeira não espera nem repete', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const opts = options();

    await expect(withRetry(fn, opts)).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it('falha transitória é repetida até dar certo', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValue('ok');
    const opts = options();

    await expect(withRetry(fn, opts)).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(opts.sleep).toHaveBeenCalledTimes(1);
  });

  /**
   * A regra que dá sentido ao helper: o que não é transitório sobe na hora.
   * Insistir contra credencial recusada só multiplica a recusa e atrasa o
   * diagnóstico — e, numa escrita, criaria duplicata.
   */
  it('falha definitiva sobe na primeira, sem repetir', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('401'));
    const opts = options({ isRetryable: () => false });

    await expect(withRetry(fn, opts)).rejects.toThrow('401');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it('esgotadas as tentativas, o erro original sobe — não um erro do retry', async () => {
    const original = new Error('Google fora do ar');
    const fn = jest.fn().mockRejectedValue(original);

    await expect(withRetry(fn, options({ attempts: 3 }))).rejects.toBe(
      original,
    );

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('a espera dobra a cada tentativa', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('503'));
    const opts = options({ attempts: 4, baseDelayMs: 100 });

    await expect(withRetry(fn, opts)).rejects.toThrow();

    const waits = (opts.sleep as jest.Mock).mock.calls.map((c) => c[0]);
    expect(waits).toEqual([100, 200, 400]);
  });

  it('o jitter só acrescenta — nunca encurta a espera', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('503'));
    const opts = options({ attempts: 2, baseDelayMs: 100, random: () => 1 });

    await expect(withRetry(fn, opts)).rejects.toThrow();

    expect((opts.sleep as jest.Mock).mock.calls[0][0]).toBe(150);
  });

  it('attempts 1 desliga o retry', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('503'));
    const opts = options({ attempts: 1 });

    await expect(withRetry(fn, opts)).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it('avisa a cada repetição, com a tentativa e a espera', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValue('ok');
    const onRetry = jest.fn();

    await withRetry(fn, options({ onRetry, baseDelayMs: 100 }));

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, delayMs: 100 }),
    );
  });
});
