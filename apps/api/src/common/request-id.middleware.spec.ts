import type { NextFunction, Request, Response } from 'express';
import { getContext } from './request-context';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './request-id.middleware';

function run(headers: Record<string, unknown>): {
  seen: string | undefined;
  setHeader: jest.Mock;
} {
  const setHeader = jest.fn();
  let seen: string | undefined;
  const next: NextFunction = () => {
    seen = getContext()?.requestId;
  };
  requestIdMiddleware(
    { headers } as unknown as Request,
    { setHeader } as unknown as Response,
    next,
  );
  return { seen, setHeader };
}

describe('requestIdMiddleware', () => {
  it('gera um id quando o cliente não manda nenhum', () => {
    const { seen, setHeader } = run({});
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, seen);
  });

  // É isto que faz o código exibido na tela ser o mesmo que aparece no log.
  it('reusa o id que o cliente mandou', () => {
    const { seen } = run({ [REQUEST_ID_HEADER]: 'web-abc123' });
    expect(seen).toBe('web-abc123');
  });

  // O id vai direto para a linha de log: um cabeçalho com quebra de linha
  // conseguiria forjar entradas de log inteiras.
  it.each([
    ['com quebra de linha', 'abc\ndef'],
    ['com espaço', 'abc def'],
    ['longo demais', 'x'.repeat(65)],
    ['vazio', '   '],
  ])('descarta id %s e gera um próprio', (_caso, value) => {
    const { seen } = run({ [REQUEST_ID_HEADER]: value });
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignora cabeçalho repetido (array)', () => {
    const { seen } = run({ [REQUEST_ID_HEADER]: ['a', 'b'] });
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('devolve o contexto ao estado anterior depois do request', () => {
    run({});
    expect(getContext()).toBeUndefined();
  });
});
