import { type BookingKeyInput, bookingKey } from './appointment-keys';

const BASE: BookingKeyInput = {
  conversationId: 'conv-1',
  leadId: 'lead-1',
  patientPhone: '5511987654321',
  startsAt: new Date('2026-10-01T13:00:00.000Z'),
  procedureId: 'proc-1',
  procedureName: 'Implante',
  now: new Date('2026-09-20T12:00:00.000Z'),
};

const keyOf = (patch: Partial<BookingKeyInput> = {}) =>
  bookingKey({ ...BASE, ...patch });

describe('bookingKey', () => {
  it('é estável para a mesma entrada — é o que faz o retry ser seguro', () => {
    expect(keyOf()).toBe(keyOf());
    expect(keyOf()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('muda com o horário: dois horários são dois agendamentos', () => {
    expect(keyOf({ startsAt: new Date('2026-10-01T14:00:00.000Z') })).not.toBe(
      keyOf(),
    );
  });

  it('muda com o procedimento: dois serviços no mesmo horário são distintos', () => {
    expect(keyOf({ procedureId: 'proc-2' })).not.toBe(keyOf());
  });

  it('muda com o contato: clientes diferentes nunca compartilham chave', () => {
    expect(keyOf({ conversationId: 'conv-2' })).not.toBe(keyOf());
  });

  describe('identidade do contato', () => {
    // A conversa é a preferida porque delimita o turno que pode ser repetido.
    it('prefere a conversa ao lead e ao telefone', () => {
      expect(keyOf({ leadId: 'outro', patientPhone: '5511000000000' })).toBe(
        keyOf(),
      );
    });

    it('cai para o lead quando não há conversa', () => {
      const semConversa = keyOf({ conversationId: null });
      expect(semConversa).not.toBeNull();
      expect(keyOf({ conversationId: null, patientPhone: '5599999999' })).toBe(
        semConversa,
      );
    });

    it('cai para o telefone quando não há conversa nem lead', () => {
      expect(keyOf({ conversationId: null, leadId: null })).not.toBeNull();
    });

    it('ignora a formatação do telefone', () => {
      const cru = keyOf({ conversationId: null, leadId: null });
      expect(
        keyOf({
          conversationId: null,
          leadId: null,
          patientPhone: '+55 (11) 98765-4321',
        }),
      ).toBe(cru);
    });

    // Sem identidade nenhuma não há o que deduplicar, e uma chave inventada
    // agruparia agendamentos de pessoas diferentes.
    it('devolve null sem conversa, sem lead e sem telefone utilizável', () => {
      expect(
        keyOf({ conversationId: null, leadId: null, patientPhone: null }),
      ).toBeNull();
      expect(
        keyOf({ conversationId: null, leadId: null, patientPhone: '123' }),
      ).toBeNull();
    });
  });

  describe('pedido sem horário', () => {
    const semHorario = { startsAt: null } as const;

    it('agrupa pelo dia — o mesmo pedido repetido não vira dois', () => {
      expect(
        keyOf({ ...semHorario, now: new Date('2026-09-20T09:00:00.000Z') }),
      ).toBe(
        keyOf({ ...semHorario, now: new Date('2026-09-20T23:00:00.000Z') }),
      );
    });

    it('mas no dia seguinte é outro pedido', () => {
      expect(
        keyOf({ ...semHorario, now: new Date('2026-09-21T09:00:00.000Z') }),
      ).not.toBe(keyOf({ ...semHorario }));
    });

    it('não colide com o mesmo contato que tem horário definido', () => {
      expect(keyOf(semHorario)).not.toBe(keyOf());
    });
  });

  describe('procedimento por nome', () => {
    const semId = { procedureId: null } as const;

    it('normaliza acento, caixa e espaço', () => {
      expect(keyOf({ ...semId, procedureName: 'Manutenção  Anual' })).toBe(
        keyOf({ ...semId, procedureName: ' manutencao anual ' }),
      );
    });

    it('distingue procedimentos diferentes', () => {
      expect(keyOf({ ...semId, procedureName: 'Limpeza' })).not.toBe(
        keyOf({ ...semId, procedureName: 'Implante' }),
      );
    });

    it('trata "sem procedimento" como um valor próprio', () => {
      expect(keyOf({ ...semId, procedureName: null })).not.toBeNull();
    });
  });
});
