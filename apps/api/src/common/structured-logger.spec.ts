import { runWithContext } from './request-context';
import { StructuredLogger } from './structured-logger';

describe('StructuredLogger', () => {
  let written: string[];
  let spy: jest.SpyInstance;

  beforeEach(() => {
    written = [];
    spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
  });

  afterEach(() => spy.mockRestore());

  const lastEntry = (): Record<string, unknown> =>
    JSON.parse(written.at(-1) as string) as Record<string, unknown>;

  it('emite uma linha JSON por evento', () => {
    new StructuredLogger(true).log('subiu', 'Bootstrap');
    expect(written).toHaveLength(1);
    expect(written[0].endsWith('\n')).toBe(true);
    expect(lastEntry()).toMatchObject({
      level: 'info',
      ctx: 'Bootstrap',
      msg: 'subiu',
    });
  });

  // O ganho central: nenhum dos ~15 serviços precisou mudar para os logs
  // passarem a sair correlacionados.
  it('anexa o contexto de correlação a um log de string comum', () => {
    runWithContext({ requestId: 'r1', clinicId: 'c1' }, () => {
      new StructuredLogger(true).warn('algo estranho', 'AgendaService');
    });
    expect(lastEntry()).toMatchObject({ requestId: 'r1', clinicId: 'c1' });
  });

  it('promove os campos de um evento estruturado para o topo do JSON', () => {
    new StructuredLogger(true).log(
      { event: 'agenda.book', outcome: 'ok', durationMs: 42 },
      'AgendaService',
    );
    expect(lastEntry()).toMatchObject({
      event: 'agenda.book',
      outcome: 'ok',
      durationMs: 42,
    });
  });

  it('redige telefone mesmo em log de string já existente', () => {
    new StructuredLogger(true).error('Falha ao enviar ao 5511987654321');
    expect(lastEntry().msg).toBe('Falha ao enviar ao 5511*****4321');
  });

  it('registra a stack do erro em campo próprio', () => {
    const error = new Error('quebrou');
    new StructuredLogger(true).error('falhou', error.stack, 'ChatService');
    const entry = lastEntry();
    expect(entry.ctx).toBe('ChatService');
    expect(String(entry.stack)).toContain('quebrou');
  });

  it('não derruba a operação quando o log não é serializável', () => {
    const circular: Record<string, unknown> = { event: 'x' };
    circular.self = circular;
    expect(() => new StructuredLogger(true).log(circular)).not.toThrow();
    expect(written).toHaveLength(1);
  });
});
