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
    name: 'Empresa Sorriso',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeSettings(over: Partial<ClinicSettings> = {}): ClinicSettings {
  return {
    id: 's1',
    clinicId: 'c1',
    logoUrl: null,
    specialty: null,
    description: null,
    assistantName: null,
    tone: null,
    greeting: null,
    greetingMediaUrl: null,
    greetingMediaType: null,
    instructions: null,
    offerEnabled: false,
    offerText: null,
    offerMediaUrl: null,
    offerMediaType: null,
    offerStartsOn: null,
    offerEndsOn: null,
    availability: null,
    whatsappInstance: null,
    whatsappOnboardingAnsweredAt: null,
    notificationsSeenAt: null,
    whatsappState: null,
    whatsappStateAt: null,
    whatsappLastError: null,
    professionalPolicy: 'primeiro_livre',
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
    offerText: null,
    offerMediaUrl: null,
    offerMediaType: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('buildSystemPrompt', () => {
  it('inclui o nome da empresa', () => {
    const prompt = buildSystemPrompt({ clinic: makeClinic(), procedures: [] });
    expect(prompt).toContain('Empresa Sorriso');
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
    expect(semSettings).toContain('Empresa Sorriso');
    expect(settingsNull).toContain('Empresa Sorriso');
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

  describe('dados já conhecidos do cliente (memória do contato)', () => {
    it('inclui nome/telefone conhecidos e instrui a não re-perguntar', () => {
      const prompt = buildSystemPrompt({
        clinic: makeClinic(),
        procedures: [],
        contact: { name: 'João Silva', phone: '5511999998888' },
      });
      expect(prompt).toContain('Nome: João Silva');
      expect(prompt).toContain('Telefone: 5511999998888');
      expect(prompt).toContain('NÃO pergunte novamente');
      expect(prompt).toContain('Cumprimente o cliente pelo nome');
    });

    it('marca o cliente como recorrente quando há agendamento anterior', () => {
      const prompt = buildSystemPrompt({
        clinic: makeClinic(),
        procedures: [],
        contact: {
          name: 'João',
          phone: '5511999998888',
          appointments: [
            {
              procedureName: 'Clareamento',
              preferredTime: 'sexta de manhã',
              createdAt: NOW,
            },
          ],
        },
      });
      expect(prompt).toContain('JÁ AGENDOU antes');
      expect(prompt).toContain('Clareamento');
      expect(prompt).toContain('sexta de manhã');
    });

    it('só telefone (identidade do canal, sem nome) também entra', () => {
      const prompt = buildSystemPrompt({
        clinic: makeClinic(),
        procedures: [],
        contact: { phone: '5511999998888' },
      });
      expect(prompt).toContain('Telefone: 5511999998888');
      expect(prompt).not.toContain('Cumprimente o cliente pelo nome');
    });

    it('contact vazio/null não gera a seção', () => {
      const semNada = buildSystemPrompt({
        clinic: makeClinic(),
        procedures: [],
        contact: { name: '  ', phone: null },
      });
      const nulo = buildSystemPrompt({
        clinic: makeClinic(),
        procedures: [],
        contact: null,
      });
      expect(semNada).not.toContain('Dados já conhecidos');
      expect(nulo).not.toContain('Dados já conhecidos');
    });
  });
});

describe('buildSystemPrompt — equipe e escolha do profissional (F20)', () => {
  const base = { clinic: makeClinic(), procedures: [] };

  it('sem equipe cadastrada, não fala em profissional', () => {
    const prompt = buildSystemPrompt({ ...base, professionals: null });
    expect(prompt).not.toContain('Profissionais que atendem');
    expect(prompt).not.toContain('`profissional`');
  });

  it('com um profissional só, lista o nome e não instrui a escolher', () => {
    const prompt = buildSystemPrompt({
      ...base,
      professionals: { names: ['Dra. Ana'], policy: 'primeiro_livre' },
    });
    expect(prompt).toContain('Profissionais que atendem: Dra. Ana.');
    expect(prompt).not.toContain('`profissionalId`');
  });

  it('primeiro_livre: consulta sem profissional e diz com quem é cada horário', () => {
    const prompt = buildSystemPrompt({
      ...base,
      professionals: {
        names: ['Dra. Ana', 'Dr. Bruno'],
        policy: 'primeiro_livre',
      },
    });
    expect(prompt).toContain('Profissionais que atendem: Dra. Ana, Dr. Bruno.');
    expect(prompt).toContain('consulte sem `profissional` e diga');
    expect(prompt).toContain('`profissionalAmbiguo`');
    expect(prompt).toContain('repasse o `profissionalId`');
    expect(prompt).not.toContain('pergunte se prefere algum profissional');
  });

  it('perguntar: pergunta a preferência antes de consultar', () => {
    const prompt = buildSystemPrompt({
      ...base,
      professionals: { names: ['Dra. Ana', 'Dr. Bruno'], policy: 'perguntar' },
    });
    expect(prompt).toContain('pergunte se prefere algum profissional');
    expect(prompt).not.toContain('consulte sem `profissional` e diga');
  });

  it('fixo: diz com quem é e proíbe oferecer escolha', () => {
    const prompt = buildSystemPrompt({
      ...base,
      professionals: {
        names: ['Dra. Ana', 'Dr. Bruno'],
        policy: 'fixo',
        fixedName: 'Dra. Ana',
      },
    });
    expect(prompt).toContain(
      'Profissional que atende os agendamentos feitos por você: Dra. Ana.',
    );
    expect(prompt).toContain('Não ofereça escolha de profissional');
    expect(prompt).not.toContain('Profissionais que atendem:');
  });
});
