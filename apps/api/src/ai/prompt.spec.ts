import type {
  Clinic,
  ClinicSettings,
  Procedure,
} from '../../generated/prisma/client';
import { buildSystemPrompt } from './prompt';

const NOW = new Date('2026-06-05T00:00:00.000Z');

function makeClinic(over: Partial<Clinic> = {}): Clinic {
  return {
    id: 'c1',
    name: 'Clínica Sorriso',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeSettings(over: Partial<ClinicSettings> = {}): ClinicSettings {
  return {
    id: 's1',
    clinicId: 'c1',
    specialty: null,
    description: null,
    assistantName: null,
    tone: null,
    greeting: null,
    instructions: null,
    offerEnabled: false,
    offerText: null,
    offerStartsOn: null,
    offerEndsOn: null,
    availability: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeProcedure(over: Partial<Procedure> = {}): Procedure {
  return {
    id: 'p1',
    clinicId: 'c1',
    name: 'Implante',
    description: 'Reposição de dente',
    priceMinCents: 150000,
    priceMaxCents: 350000,
    durationMinutes: 90,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('buildSystemPrompt', () => {
  it('inclui o nome da clínica', () => {
    const prompt = buildSystemPrompt({ clinic: makeClinic(), procedures: [] });
    expect(prompt).toContain('Clínica Sorriso');
  });

  it('inclui especialidade, persona, saudação e instruções quando há settings', () => {
    const prompt = buildSystemPrompt({
      clinic: makeClinic(),
      settings: makeSettings({
        specialty: 'ortodontia e implantes',
        assistantName: 'Sofia',
        tone: 'acolhedor',
        greeting: 'Olá! Como posso ajudar seu sorriso hoje?',
        instructions: 'Sempre ofereça a avaliação gratuita de junho.',
      }),
      procedures: [],
    });
    expect(prompt).toContain('ortodontia e implantes');
    expect(prompt).toContain('Sofia');
    expect(prompt).toContain('acolhedor');
    expect(prompt).toContain('Olá! Como posso ajudar seu sorriso hoje?');
    expect(prompt).toContain('avaliação gratuita de junho');
  });

  it('inclui os procedimentos cadastrados com faixa de preço e duração', () => {
    const prompt = buildSystemPrompt({
      clinic: makeClinic(),
      procedures: [
        makeProcedure({
          name: 'Clareamento',
          priceMinCents: 50000,
          priceMaxCents: 120000,
          durationMinutes: 60,
        }),
        makeProcedure({
          id: 'p2',
          name: 'Limpeza',
          priceMinCents: 15000,
          priceMaxCents: 15000,
          durationMinutes: 45,
        }),
      ],
    });
    expect(prompt).toContain('Clareamento');
    expect(prompt).toContain('Limpeza');
    expect(prompt).toContain('R$');
    expect(prompt).toMatch(/duração: ~60 min/);
  });

  it('funciona sem settings (undefined e null)', () => {
    const semSettings = buildSystemPrompt({
      clinic: makeClinic(),
      procedures: [makeProcedure()],
    });
    const settingsNull = buildSystemPrompt({
      clinic: makeClinic(),
      settings: null,
      procedures: [],
    });
    expect(semSettings).toContain('Clínica Sorriso');
    expect(settingsNull).toContain('Clínica Sorriso');
    // não deve vazar "undefined"/"null" no texto.
    expect(semSettings).not.toMatch(/undefined|null/);
    expect(settingsNull).not.toMatch(/undefined|null/);
  });

  it('funciona sem procedimentos (lista vazia)', () => {
    const prompt = buildSystemPrompt({ clinic: makeClinic(), procedures: [] });
    expect(prompt).toContain('ainda não cadastrou procedimentos');
  });

  it('inclui a oferta vigente apenas quando ativa, com a vigência', () => {
    const comOferta = buildSystemPrompt({
      clinic: makeClinic(),
      settings: makeSettings({
        offerEnabled: true,
        offerText: 'Avaliação inicial gratuita em junho.',
        offerStartsOn: '01/06/2026',
        offerEndsOn: '30/06/2026',
      }),
      procedures: [],
    });
    expect(comOferta).toContain('Avaliação inicial gratuita em junho.');
    expect(comOferta).toContain('01/06/2026');
    expect(comOferta).toContain('30/06/2026');

    const ofertaPausada = buildSystemPrompt({
      clinic: makeClinic(),
      settings: makeSettings({
        offerEnabled: false,
        offerText: 'Promo secreta.',
      }),
      procedures: [],
    });
    expect(ofertaPausada).not.toContain('Promo secreta.');
  });

  it('resume a disponibilidade listando só os dias abertos', () => {
    const prompt = buildSystemPrompt({
      clinic: makeClinic(),
      settings: makeSettings({
        availability: [
          { day: 'Segunda a sexta', hours: '08:00 – 18:00', open: true },
          { day: 'Domingo', hours: 'Fechado', open: false },
        ],
      }),
      procedures: [],
    });
    expect(prompt).toContain('Segunda a sexta');
    expect(prompt).not.toContain('Domingo');
  });

  it('inclui as diretrizes-chave (lead nome+telefone e não inventar preços)', () => {
    const prompt = buildSystemPrompt({
      clinic: makeClinic(),
      procedures: [makeProcedure()],
    });
    expect(prompt).toContain('nome e o telefone');
    expect(prompt).toContain('Não invente preços');
  });
});
