import {
  addZonedDays,
  dateKeyToUtc,
  formatDatePtBr,
  formatLocalDateTime,
  formatTimePtBr,
  isZonedWeekend,
  parseHhMm,
  parseLocalDateTime,
  startOfZonedDay,
  toZonedParts,
  zonedDateKey,
  zonedMinutesOfDay,
  zonedTimeToUtc,
} from './time';

const SP = 'America/Sao_Paulo';
/** Fuso com horário de verão — garante que a conversão não é um "-3" fixo. */
const NY = 'America/New_York';

describe('time (fuso da empresa · F9)', () => {
  it('zonedTimeToUtc: hora de parede em SP vira o instante UTC correto', () => {
    // 12/09/2026 14:30 em São Paulo (UTC-3) = 17:30 UTC.
    const instant = zonedTimeToUtc(
      { year: 2026, month: 9, day: 12, hour: 14, minute: 30 },
      SP,
    );
    expect(instant.toISOString()).toBe('2026-09-12T17:30:00.000Z');
  });

  it('zonedTimeToUtc: respeita horário de verão onde ele existe', () => {
    // Julho em Nova York é EDT (UTC-4); janeiro é EST (UTC-5).
    const summer = zonedTimeToUtc(
      { year: 2026, month: 7, day: 15, hour: 9 },
      NY,
    );
    const winter = zonedTimeToUtc(
      { year: 2026, month: 1, day: 15, hour: 9 },
      NY,
    );
    expect(summer.toISOString()).toBe('2026-07-15T13:00:00.000Z');
    expect(winter.toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });

  it('toZonedParts / zonedTimeToUtc são inversos', () => {
    const original = new Date('2026-09-12T17:30:00.000Z');
    const parts = toZonedParts(original, SP);
    expect(zonedTimeToUtc(parts, SP).toISOString()).toBe(
      original.toISOString(),
    );
  });

  it('zonedDateKey: perto da meia-noite, UTC e o fuso local ficam em dias diferentes', () => {
    // 02:00Z de 13/09 ainda é 23:00 de 12/09 em São Paulo — o caso que faria o
    // teto diário e o feriado olharem para o dia errado.
    const instant = new Date('2026-09-13T02:00:00.000Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-09-13');
    expect(zonedDateKey(instant, SP)).toBe('2026-09-12');
  });

  it('startOfZonedDay devolve a meia-noite local, não a UTC', () => {
    const instant = new Date('2026-09-12T17:30:00.000Z');
    expect(startOfZonedDay(instant, SP).toISOString()).toBe(
      '2026-09-12T03:00:00.000Z',
    );
  });

  it('zonedMinutesOfDay mede a hora local', () => {
    const instant = new Date('2026-09-12T17:30:00.000Z'); // 14:30 em SP
    expect(zonedMinutesOfDay(instant, SP)).toBe(14 * 60 + 30);
  });

  it('parseHhMm aceita HH:mm e cai no padrão quando o formato é inválido', () => {
    expect(parseHhMm('08:30', 0)).toBe(510);
    expect(parseHhMm('24:00', 480)).toBe(480);
    expect(parseHhMm('oito horas', 480)).toBe(480);
  });

  it('isZonedWeekend usa o dia da semana local', () => {
    // 2026-09-12 é um sábado.
    expect(isZonedWeekend(new Date('2026-09-12T15:00:00.000Z'), SP)).toBe(true);
    expect(isZonedWeekend(new Date('2026-09-14T15:00:00.000Z'), SP)).toBe(
      false,
    );
  });

  it('addZonedDays preserva a hora de parede', () => {
    const start = new Date('2026-09-12T17:30:00.000Z'); // 14:30 em SP
    const later = addZonedDays(start, 3, SP);
    expect(formatTimePtBr(later, SP)).toBe('14:30');
    expect(zonedDateKey(later, SP)).toBe('2026-09-15');
  });

  it('dateKeyToUtc converte AAAA-MM-DD para a meia-noite local', () => {
    expect(dateKeyToUtc('2026-09-12', SP)?.toISOString()).toBe(
      '2026-09-12T03:00:00.000Z',
    );
    expect(dateKeyToUtc('12/09/2026', SP)).toBeNull();
  });

  describe('parseLocalDateTime (o horário que o agente informa)', () => {
    it('sem offset, é hora de parede da empresa', () => {
      expect(parseLocalDateTime('2026-09-12T14:30', SP)?.toISOString()).toBe(
        '2026-09-12T17:30:00.000Z',
      );
      expect(parseLocalDateTime('2026-09-12 14:30', SP)?.toISOString()).toBe(
        '2026-09-12T17:30:00.000Z',
      );
    });

    it('com offset explícito, respeita o que veio', () => {
      expect(
        parseLocalDateTime('2026-09-12T14:30:00Z', SP)?.toISOString(),
      ).toBe('2026-09-12T14:30:00.000Z');
    });

    it('recusa entrada sem hora ou fora da faixa', () => {
      expect(parseLocalDateTime('2026-09-12', SP)).toBeNull();
      expect(parseLocalDateTime('2026-09-12T99:30', SP)).toBeNull();
      expect(parseLocalDateTime('   ', SP)).toBeNull();
    });
  });

  it('formatadores em pt-BR alimentam os textos das automações', () => {
    const instant = new Date('2026-09-12T17:30:00.000Z');
    expect(formatDatePtBr(instant, SP)).toBe('sábado, 12/09');
    expect(formatTimePtBr(instant, SP)).toBe('14:30');
  });

  describe('formatLocalDateTime (o dataHora que a tool devolve ao agente)', () => {
    it('é a hora de parede da empresa, sem offset', () => {
      const instant = new Date('2026-09-12T17:30:00.000Z');
      expect(formatLocalDateTime(instant, SP)).toBe('2026-09-12T14:30');
    });

    it('é o inverso de parseLocalDateTime — repassar não desloca o horário', () => {
      const instant = new Date('2026-09-08T16:00:00.000Z'); // 13:00 em SP
      const echoed = formatLocalDateTime(instant, SP);
      expect(parseLocalDateTime(echoed, SP)?.toISOString()).toBe(
        instant.toISOString(),
      );
    });
  });
});
