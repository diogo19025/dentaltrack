import { randomBytes } from 'node:crypto';
import {
  calendarVerificationCode,
  descriptionHasCode,
} from './calendar-ownership';

describe('calendar-ownership (prova de posse da agenda Google)', () => {
  const KEY = randomBytes(32);

  it('gera um código estável por empresa, no formato DT-XXXX-XXXX', () => {
    const code = calendarVerificationCode(KEY, 'clinica-a');
    expect(code).toMatch(/^DT-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(calendarVerificationCode(KEY, 'clinica-a')).toBe(code);
  });

  it('outra empresa, ou outra chave de servidor, tem outro código', () => {
    const code = calendarVerificationCode(KEY, 'clinica-a');
    expect(calendarVerificationCode(KEY, 'clinica-b')).not.toBe(code);
    expect(calendarVerificationCode(randomBytes(32), 'clinica-a')).not.toBe(
      code,
    );
  });

  it('acha o código na descrição sem diferenciar maiúsculas', () => {
    expect(descriptionHasCode('agenda — dt-1a2b-3c4d', 'DT-1A2B-3C4D')).toBe(
      true,
    );
    expect(descriptionHasCode('agenda da clínica', 'DT-1A2B-3C4D')).toBe(false);
    expect(descriptionHasCode(undefined, 'DT-1A2B-3C4D')).toBe(false);
  });
});
