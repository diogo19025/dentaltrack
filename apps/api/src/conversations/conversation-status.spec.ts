import { canTransition } from './conversation-status';

describe('canTransition', () => {
  it('permite em_andamento → agendada e em_andamento → abandonada', () => {
    expect(canTransition('em_andamento', 'agendada')).toBe(true);
    expect(canTransition('em_andamento', 'abandonada')).toBe(true);
  });

  it('permite reabrir abandonada → em_andamento', () => {
    expect(canTransition('abandonada', 'em_andamento')).toBe(true);
  });

  it('considera mesmo estado um no-op válido', () => {
    expect(canTransition('agendada', 'agendada')).toBe(true);
  });

  it('bloqueia transições absurdas', () => {
    expect(canTransition('agendada', 'abandonada')).toBe(false);
    expect(canTransition('agendada', 'em_andamento')).toBe(false);
    expect(canTransition('abandonada', 'agendada')).toBe(false);
  });
});
