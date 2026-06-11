import { scoreLead, type LeadScoreSignals } from './lead-scoring';

/** `now` fixo → recência determinística. */
const NOW = new Date('2026-06-11T12:00:00Z');

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const signals = (partial: Partial<LeadScoreSignals>): LeadScoreSignals => ({
  hasAppointment: false,
  patientMessages: 0,
  tagConfidences: [],
  lastActivityAt: null,
  latestStatus: null,
  ...partial,
});

describe('scoreLead', () => {
  it('agendado ativo (appointment + 5 msgs + tag 0.9 + atividade <24h) → 78, quente', () => {
    // 30 + 21.875 + 10.8 + 15 = 77.675
    expect(
      scoreLead(
        signals({
          hasAppointment: true,
          patientMessages: 5,
          tagConfidences: [0.9],
          lastActivityAt: hoursAgo(12),
          latestStatus: 'agendada',
        }),
        NOW,
      ),
    ).toEqual({ score: 78, temperature: 'quente' });
  });

  it('engajado sem agendar (8 msgs + tags 0.8/0.7 + <24h) → 68, quente', () => {
    // 35 + 18 + 15 = 68
    expect(
      scoreLead(
        signals({
          patientMessages: 8,
          tagConfidences: [0.8, 0.7],
          lastActivityAt: hoursAgo(2),
          latestStatus: 'em_andamento',
        }),
        NOW,
      ),
    ).toEqual({ score: 68, temperature: 'quente' });
  });

  it('médio (3 msgs + tag 0.8 + <72h) → 33, medio', () => {
    // 13.125 + 9.6 + 10 = 32.725
    expect(
      scoreLead(
        signals({
          patientMessages: 3,
          tagConfidences: [0.8],
          lastActivityAt: hoursAgo(48),
          latestStatus: 'em_andamento',
        }),
        NOW,
      ),
    ).toEqual({ score: 33, temperature: 'medio' });
  });

  it('recém-chegado (1 msg, sem tag, <24h) → 19, fraco', () => {
    // 4.375 + 15 = 19.375
    expect(
      scoreLead(
        signals({
          patientMessages: 1,
          lastActivityAt: hoursAgo(1),
          latestStatus: 'em_andamento',
        }),
        NOW,
      ),
    ).toEqual({ score: 19, temperature: 'fraco' });
  });

  it('abandonado (4 msgs + tag 0.9, 10 dias atrás, sem appointment) → 8, fraco', () => {
    // 17.5 + 10.8 + 0 − 20 = 8.3
    expect(
      scoreLead(
        signals({
          patientMessages: 4,
          tagConfidences: [0.9],
          lastActivityAt: hoursAgo(240),
          latestStatus: 'abandonada',
        }),
        NOW,
      ),
    ).toEqual({ score: 8, temperature: 'fraco' });
  });

  it('sem sinais → 0, fraco; abandono puro não fica negativo (clamp inferior)', () => {
    expect(scoreLead(signals({}), NOW)).toEqual({
      score: 0,
      temperature: 'fraco',
    });
    expect(scoreLead(signals({ latestStatus: 'abandonada' }), NOW)).toEqual({
      score: 0,
      temperature: 'fraco',
    });
  });

  it('lead máximo (appointment + 8 msgs + tags acima do teto + <24h) → 100 (clamp superior)', () => {
    // 30 + 35 + min(36, 20) + 15 = 100
    expect(
      scoreLead(
        signals({
          hasAppointment: true,
          patientMessages: 20,
          tagConfidences: [1, 1, 1],
          lastActivityAt: hoursAgo(0),
          latestStatus: 'agendada',
        }),
        NOW,
      ),
    ).toEqual({ score: 100, temperature: 'quente' });
  });

  it('abandono não penaliza quem já agendou', () => {
    // 30 + 17.5 + 0 = 47.5 → 48 (sem o −20)
    expect(
      scoreLead(
        signals({
          hasAppointment: true,
          patientMessages: 4,
          lastActivityAt: hoursAgo(240),
          latestStatus: 'abandonada',
        }),
        NOW,
      ),
    ).toEqual({ score: 48, temperature: 'medio' });
  });

  it('limiar quente: 60 é quente, 59 é medio', () => {
    // 35 (8 msgs) + 15 (tags 1.0+0.25) + 10 (<72h) = 60
    expect(
      scoreLead(
        signals({
          patientMessages: 8,
          tagConfidences: [1, 0.25],
          lastActivityAt: hoursAgo(48),
        }),
        NOW,
      ),
    ).toEqual({ score: 60, temperature: 'quente' });
    // 35 (8 msgs) + 9 (tag 0.75) + 15 (<24h) = 59
    expect(
      scoreLead(
        signals({
          patientMessages: 8,
          tagConfidences: [0.75],
          lastActivityAt: hoursAgo(12),
        }),
        NOW,
      ),
    ).toEqual({ score: 59, temperature: 'medio' });
  });

  it('limiar médio: 30 é medio, 29 é fraco', () => {
    // 30 (appointment) e nada mais = 30
    expect(scoreLead(signals({ hasAppointment: true }), NOW)).toEqual({
      score: 30,
      temperature: 'medio',
    });
    // 8.75 (2 msgs) + 15 (tags 1.0+0.25) + 5 (<7d) = 28.75 → 29
    expect(
      scoreLead(
        signals({
          patientMessages: 2,
          tagConfidences: [1, 0.25],
          lastActivityAt: hoursAgo(96),
        }),
        NOW,
      ),
    ).toEqual({ score: 29, temperature: 'fraco' });
  });

  it('recência sem atividade (lastActivityAt null) não pontua', () => {
    // 35 (8 msgs) apenas
    expect(scoreLead(signals({ patientMessages: 8 }), NOW)).toEqual({
      score: 35,
      temperature: 'medio',
    });
  });
});
