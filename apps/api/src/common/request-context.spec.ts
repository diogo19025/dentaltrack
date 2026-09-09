import {
  getContext,
  newCorrelationId,
  runWithContext,
  setContext,
} from './request-context';

describe('request-context', () => {
  it('expõe o contexto dentro do escopo e nada fora dele', () => {
    expect(getContext()).toBeUndefined();
    runWithContext({ requestId: 'r1' }, () => {
      expect(getContext()?.requestId).toBe('r1');
    });
    expect(getContext()).toBeUndefined();
  });

  // A propriedade que sustenta o desenho: o `clinicId` só é conhecido depois do
  // guard, e o `conversationId` depois de vários `await`. Se o contexto não
  // sobrevivesse a eles, nada disso apareceria no log.
  it('sobrevive a await', async () => {
    await runWithContext({ requestId: 'r2' }, async () => {
      await Promise.resolve();
      setContext({ clinicId: 'c1' });
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getContext()).toMatchObject({ requestId: 'r2', clinicId: 'c1' });
    });
  });

  it('isola escopos concorrentes', async () => {
    const seen: string[] = [];
    const run = (id: string, delay: number) =>
      runWithContext({ requestId: id }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        seen.push(getContext()?.requestId ?? 'perdido');
      });

    await Promise.all([run('a', 5), run('b', 1)]);
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('enriquecer fora de um escopo não lança', () => {
    expect(() => setContext({ clinicId: 'c1' })).not.toThrow();
  });

  it('gera id de correlação prefixado pela origem', () => {
    expect(newCorrelationId('job')).toMatch(/^job:[0-9a-f]{8}$/);
  });
});
