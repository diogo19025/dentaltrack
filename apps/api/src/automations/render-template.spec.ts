import {
  DEFAULT_AUTOMATION_SETTINGS,
  renderTemplate,
} from '@dentaltrack/shared';

/**
 * O texto do lembrete é do dono da empresa; o que sai tem que ser previsível
 * com e sem cada marcador — nunca um marcador cru nem uma preposição solta.
 */
describe('renderTemplate', () => {
  const base = {
    nome: 'Ana',
    empresa: 'Clínica Sol',
    data: '10/10',
    hora: '14:00',
    procedimento: 'de limpeza',
  };

  it('cita o profissional quando o agendamento tem um', () => {
    const text = renderTemplate(DEFAULT_AUTOMATION_SETTINGS.lembrete1d.template, {
      ...base,
      profissional: 'Dra. Ana Paula',
    });
    expect(text).toBe(
      'Olá, Ana! Seu horário na Clínica Sol com Dra. Ana Paula é amanhã, 10/10, às 14:00. Posso confirmar sua presença?',
    );
  });

  it('some com a preposição quando o profissional vem vazio', () => {
    const text = renderTemplate(DEFAULT_AUTOMATION_SETTINGS.lembrete1d.template, {
      ...base,
      profissional: '',
    });
    expect(text).toBe(
      'Olá, Ana! Seu horário na Clínica Sol é amanhã, 10/10, às 14:00. Posso confirmar sua presença?',
    );
  });

  it('todos os textos padrão ficam legíveis sem profissional', () => {
    const { lembrete3d, lembrete1d, lembrete1h, atraso, falta, retorno } =
      DEFAULT_AUTOMATION_SETTINGS;
    for (const rule of [lembrete3d, lembrete1d, lembrete1h, atraso, falta, retorno]) {
      const text = renderTemplate(rule.template, base);
      expect(text).not.toMatch(/\bcom\b\s*[,.!?]/);
      expect(text).not.toMatch(/\{\w+\}/);
      expect(text).not.toMatch(/ {2,}/);
    }
  });

  it('não mexe em preposição seguida de marcador preenchido', () => {
    expect(
      renderTemplate('Lembrete de {procedimento} na {empresa}.', {
        procedimento: 'limpeza',
        empresa: 'Clínica Sol',
      }),
    ).toBe('Lembrete de limpeza na Clínica Sol.');
  });
});
