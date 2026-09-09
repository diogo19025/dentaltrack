import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { runWithContext } from './request-context';

function hostFor(headersSent = false) {
  const response = {
    headersSent,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const request = { method: 'GET', originalUrl: '/leads?busca=ana' };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('preserva o corpo dos erros HTTP e acrescenta o requestId', () => {
    const { host, response } = hostFor();
    runWithContext({ requestId: 'r1' }, () => {
      filter.catch(new NotFoundException('Conversa não encontrada.'), host);
    });

    expect(response.status).toHaveBeenCalledWith(404);
    // O contrato que o front já consome não muda — só ganha um campo.
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'Conversa não encontrada.',
      error: 'Not Found',
      requestId: 'r1',
    });
  });

  it('normaliza corpo em string para o mesmo formato de objeto', () => {
    const { host, response } = hostFor();
    const exception = new BadRequestException();
    jest.spyOn(exception, 'getResponse').mockReturnValue('Requisição inválida');

    runWithContext({ requestId: 'r2' }, () => filter.catch(exception, host));

    expect(response.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Requisição inválida',
      requestId: 'r2',
    });
  });

  it('converte erro não-HTTP em 500 sem vazar a mensagem interna', () => {
    const { host, response } = hostFor();
    runWithContext({ requestId: 'r3' }, () => {
      filter.catch(new Error('connect ECONNREFUSED 10.0.0.7:5432'), host);
    });

    expect(response.status).toHaveBeenCalledWith(500);
    const body = response.json.mock.calls[0][0] as Record<string, unknown>;
    expect(body.requestId).toBe('r3');
    expect(String(body.message)).not.toContain('ECONNREFUSED');
  });

  // O `POST /chat` responde por SSE: escrever JSON no meio do stream
  // corromperia a resposta que o cliente já está lendo.
  it('não escreve nada depois que a resposta já começou', () => {
    const { host, response } = hostFor(true);
    filter.catch(new Error('falhou no meio do stream'), host);
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('não quebra fora de um contexto HTTP', () => {
    const host = { getType: () => 'rpc' } as unknown as ArgumentsHost;
    expect(() => filter.catch(new Error('x'), host)).not.toThrow();
  });
});
