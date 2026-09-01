import {
  normalizeEntityIds,
  parseExternalDateTime,
  pick,
  readDateTime,
  readId,
  readList,
  readNumber,
  readString,
  toCompactDate,
} from './field-reader';

const SP = 'America/Sao_Paulo';

describe('field-reader (leitura tolerante da API externa · F9)', () => {
  describe('pick: a mesma informação, escrita de jeitos diferentes', () => {
    it('casa ignorando caixa e separadores', () => {
      expect(pick({ PatientName: 'Ana' }, 'patientName')).toBe('Ana');
      expect(pick({ patient_name: 'Ana' }, 'PatientName')).toBe('Ana');
      expect(pick({ 'Patient Name': 'Ana' }, 'patient_name')).toBe('Ana');
    });

    it('ignora vazio e segue para o próximo candidato', () => {
      expect(pick({ Name: '', FullName: 'Ana' }, 'Name', 'FullName')).toBe(
        'Ana',
      );
      expect(pick({ Name: null }, 'Name')).toBeUndefined();
    });

    it('entrada que não é objeto não quebra', () => {
      expect(pick(null, 'x')).toBeUndefined();
      expect(pick([1, 2], 'x')).toBeUndefined();
    });
  });

  describe('readId: id externo sempre vira texto', () => {
    it('normaliza número e texto para a mesma forma', () => {
      expect(readId({ Id: 123 }, 'id')).toBe('123');
      expect(readId({ Id: '123' }, 'id')).toBe('123');
    });

    it('sem valor devolve null', () => {
      expect(readId({}, 'id')).toBeNull();
    });
  });

  it('readString e readNumber convertem os tipos que aparecem na prática', () => {
    expect(readString({ Total: 7 }, 'total')).toBe('7');
    expect(readNumber({ duration: '30' }, 'duration')).toBe(30);
    expect(readNumber({ price: '10,5' }, 'price')).toBe(10.5);
    expect(readNumber({ price: 'grátis' }, 'price')).toBeNull();
  });

  describe('readList: a lista vem embrulhada de formas diferentes', () => {
    it('aceita array puro', () => {
      expect(readList([{ a: 1 }, { a: 2 }])).toHaveLength(2);
    });

    it('desembrulha os invólucros usuais', () => {
      expect(readList({ data: [{ a: 1 }] })).toHaveLength(1);
      expect(readList({ Result: [{ a: 1 }] })).toHaveLength(1);
      expect(
        readList({ appointments: [{ a: 1 }] }, 'appointments'),
      ).toHaveLength(1);
    });

    it('desembrulha um nível aninhado', () => {
      expect(readList({ data: { records: [{ a: 1 }] } })).toHaveLength(1);
    });

    it('resposta inesperada vira lista vazia, não exceção', () => {
      // Agenda indisponível é caso de degradar — nunca de derrubar o
      // atendimento em curso.
      expect(readList({ error: 'unauthorized' })).toEqual([]);
      expect(readList(null)).toEqual([]);
      expect(readList('boom')).toEqual([]);
    });
  });

  describe('datas: sem offset é hora de parede da empresa', () => {
    it('AAAA-MM-DD + campo de hora separado', () => {
      const parsed = parseExternalDateTime('2026-09-12', '14:30', SP);
      expect(parsed?.toISOString()).toBe('2026-09-12T17:30:00.000Z');
    });

    it('data e hora juntas têm precedência sobre o campo separado', () => {
      const parsed = parseExternalDateTime('2026-09-12 16:00', '14:30', SP);
      expect(parsed?.toISOString()).toBe('2026-09-12T19:00:00.000Z');
    });

    it('ISO com offset é respeitado como veio', () => {
      const parsed = parseExternalDateTime('2026-09-12T14:30:00Z', null, SP);
      expect(parsed?.toISOString()).toBe('2026-09-12T14:30:00.000Z');
    });

    it('aceita DD/MM/AAAA e o compacto AAAAMMDD', () => {
      expect(
        parseExternalDateTime('12/09/2026', '09:00', SP)?.toISOString(),
      ).toBe('2026-09-12T12:00:00.000Z');
      expect(
        parseExternalDateTime('20260912', '09:00', SP)?.toISOString(),
      ).toBe('2026-09-12T12:00:00.000Z');
    });

    it('sem hora assume meia-noite local; formato irreconhecível vira null', () => {
      expect(parseExternalDateTime('2026-09-12', null, SP)?.toISOString()).toBe(
        '2026-09-12T03:00:00.000Z',
      );
      expect(parseExternalDateTime('setembro', null, SP)).toBeNull();
    });

    it('readDateTime lê a data por qualquer uma das grafias candidatas', () => {
      const parsed = readDateTime(
        { Date: '2026-09-12', fromTime: '14:30' },
        {
          dateKeys: ['date', 'StartDateTime'],
          timeKeys: ['fromTime'],
          timeZone: SP,
        },
      );
      expect(parsed?.toISOString()).toBe('2026-09-12T17:30:00.000Z');
    });
  });

  it('toCompactDate produz AAAAMMDD no fuso da empresa', () => {
    // 02:00Z de 13/09 ainda é 12/09 em São Paulo.
    expect(toCompactDate(new Date('2026-09-13T02:00:00.000Z'), SP)).toBe(
      '20260912',
    );
  });

  describe('normalizeEntityIds: id de entidade vai como inteiro nativo', () => {
    it('converte os campos conhecidos de id', () => {
      const body = normalizeEntityIds({
        Clinic_BusinessId: '12',
        Dentist_PersonId: '340',
      });
      expect(body).toEqual({ Clinic_BusinessId: 12, Dentist_PersonId: 340 });
    });

    it('não toca em texto que por acaso só tem dígitos', () => {
      // Telefone, documento e identificador com zero à esquerda continuam
      // texto: convertê-los destruiria o valor.
      const body = normalizeEntityIds({
        Phone: '5511999998888',
        PatientName: '2024',
        Clinic_BusinessId: '007',
      });
      expect(body).toEqual({
        Phone: '5511999998888',
        PatientName: '2024',
        Clinic_BusinessId: '007',
      });
    });

    it('mantém valores que já são número ou não são texto', () => {
      expect(
        normalizeEntityIds({ Clinic_BusinessId: 12, Notes: null }),
      ).toEqual({ Clinic_BusinessId: 12, Notes: null });
    });
  });
});
