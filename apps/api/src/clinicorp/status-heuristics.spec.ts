import { suggestStatus, suggestStatusMappings } from './status-heuristics';

describe('status-heuristics (sugestão de mapeamento · F9)', () => {
  it('reconhece as formas usuais de cada status', () => {
    expect(suggestStatus('Agendado')).toBe('agendado');
    expect(suggestStatus('Confirmado')).toBe('confirmado');
    expect(suggestStatus('Atendido')).toBe('compareceu');
    expect(suggestStatus('Em atendimento')).toBe('compareceu');
    expect(suggestStatus('Sala de espera')).toBe('compareceu');
    expect(suggestStatus('Faltou')).toBe('faltou');
    expect(suggestStatus('Cancelado')).toBe('cancelado');
  });

  it('"Não compareceu" é falta, não presença', () => {
    // A armadilha do casamento por substring: "compareceu" está dentro de "não
    // compareceu", e classificar errado inverteria o gatilho da remarcação.
    expect(suggestStatus('Não compareceu')).toBe('faltou');
    expect(suggestStatus('NAO COMPARECEU')).toBe('faltou');
    expect(suggestStatus('No-show')).toBe('faltou');
  });

  it('ignora acento e caixa', () => {
    expect(suggestStatus('atendído')).toBe('compareceu');
    expect(suggestStatus('  CANCELADO  ')).toBe('cancelado');
  });

  it('nome não reconhecido devolve null — "não mexe"', () => {
    // O princípio: um status que ninguém reconheceu jamais pode reclassificar
    // um agendamento por conta própria.
    expect(suggestStatus('Orçamento enviado')).toBeNull();
    expect(suggestStatus('')).toBeNull();
    expect(suggestStatus('XPTO-42')).toBeNull();
  });

  describe('suggestStatusMappings', () => {
    const statuses = [
      { id: '1', name: 'Agendado' },
      { id: '6', name: 'Faltou' },
      { id: '8', name: 'Orçamento enviado' },
    ];

    it('sugere para os reconhecidos e deixa null nos demais', () => {
      expect(suggestStatusMappings(statuses)).toEqual([
        { externalId: '1', externalName: 'Agendado', status: 'agendado' },
        { externalId: '6', externalName: 'Faltou', status: 'faltou' },
        { externalId: '8', externalName: 'Orçamento enviado', status: null },
      ]);
    });

    it('nunca sobrescreve a decisão do operador', () => {
      const existing = [
        // O operador decidiu que "Agendado" na conta dele significa confirmado…
        {
          externalId: '1',
          externalName: 'Agendado',
          status: 'confirmado' as const,
        },
        // …e que "Faltou" deve ser ignorado.
        { externalId: '6', externalName: 'Faltou', status: null },
      ];
      const result = suggestStatusMappings(statuses, existing);
      expect(result[0].status).toBe('confirmado');
      expect(result[1].status).toBeNull();
      expect(result[2].status).toBeNull();
    });

    it('atualiza o nome exibido quando ele muda na conta', () => {
      const existing = [
        {
          externalId: '1',
          externalName: 'Nome antigo',
          status: 'agendado' as const,
        },
      ];
      const result = suggestStatusMappings(statuses, existing);
      expect(result[0]).toEqual({
        externalId: '1',
        externalName: 'Agendado',
        status: 'agendado',
      });
    });
  });
});
