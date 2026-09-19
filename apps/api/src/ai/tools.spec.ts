import { type ChatToolsContext, buildChatTools } from './tools';

const CLINIC_ID = '00000000-0000-0000-0000-0000000c1141';
const CONVERSATION_ID = '22222222-2222-2222-2222-222222222222';

// Helper para chamar o execute de uma tool (ignora o 2º arg de opções do SDK).
function exec(tool: unknown, input: unknown): Promise<any> {
  const fn = (tool as { execute: (i: unknown, o: unknown) => Promise<unknown> })
    .execute;
  return fn(input, {}) as Promise<any>;
}

describe('buildChatTools', () => {
  const prismaMock = {
    procedure: { findMany: jest.fn(), findFirst: jest.fn() },
    tag: { findMany: jest.fn().mockResolvedValue([]) },
    clinicSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    conversation: { findFirst: jest.fn(), update: jest.fn() },
    lead: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    appointment: { create: jest.fn() },
  };
  const conversationsMock = { markAsScheduled: jest.fn() };

  function tools(attachments?: unknown[]) {
    return buildChatTools({
      prisma: prismaMock,
      conversations: conversationsMock,
      clinicId: CLINIC_ID,
      conversationId: CONVERSATION_ID,
      ...(attachments ? { attachments } : {}),
    } as unknown as ChatToolsContext);
  }

  beforeEach(() => jest.clearAllMocks());

  /**
   * Nenhuma tool pode declarar objeto de parâmetros vazio.
   *
   * Não é preferência de estilo: o Gemini recusa `properties: {}` com 400
   * INVALID_ARGUMENT, e ele é o **fallback** — o caminho que só roda depois de
   * o primário cair, quando o usuário já vê o 503 amigável de sempre. Uma tool
   * assim mata o plano B sem sintoma próprio, por semanas. Este teste é a
   * guarda para a próxima tool, não para a que existe hoje.
   */
  it('nenhuma tool declara objeto de parâmetros vazio (o fallback Gemini recusa)', () => {
    const vazias = Object.entries(tools())
      .filter(([, tool]) => {
        const schema = (
          tool as { inputSchema?: { jsonSchema?: { properties?: object } } }
        ).inputSchema?.jsonSchema;
        return Object.keys(schema?.properties ?? {}).length === 0;
      })
      .map(([name]) => name);

    expect(vazias).toEqual([]);
  });

  it('findMyAppointments aceita o `motivo` opcional sem exigi-lo', () => {
    const schema = (
      tools().findMyAppointments as unknown as {
        inputSchema: {
          jsonSchema: { properties: Record<string, unknown>; required?: [] };
        };
      }
    ).inputSchema.jsonSchema;

    expect(Object.keys(schema.properties)).toContain('motivo');
    expect(schema.required ?? []).toEqual([]);
  });

  it('searchProcedures: retorna procedimentos da empresa com preço formatado', async () => {
    prismaMock.procedure.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        name: 'Implante',
        description: 'Reposição de dente',
        priceMinCents: 150000,
        priceMaxCents: 350000,
        durationMinutes: 90,
        tags: [{ name: 'implante' }],
      },
    ]);

    const res = await exec(tools().searchProcedures, { query: 'implante' });

    // escopado por empresa + ativo
    expect(prismaMock.procedure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clinicId: CLINIC_ID, active: true }),
      }),
    );
    expect(res.procedures[0].nome).toBe('Implante');
    expect(res.procedures[0].preco).toContain('R$');
    expect(res.total).toBe(1);
  });

  it('captureLead: cria lead novo e vincula à conversa', async () => {
    prismaMock.conversation.findFirst.mockResolvedValueOnce({ leadId: null });
    prismaMock.lead.create.mockResolvedValueOnce({ id: 'lead-1' });
    prismaMock.conversation.update.mockResolvedValueOnce({});

    const res = await exec(tools().captureLead, {
      nome: 'João',
      telefone: '11999990000',
    });

    expect(res).toEqual({ ok: true, leadId: 'lead-1' });
    expect(prismaMock.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clinicId: CLINIC_ID,
          name: 'João',
          phone: '11999990000',
        }),
      }),
    );
    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { leadId: 'lead-1' },
    });
  });

  it('captureLead: atualiza o lead existente da conversa', async () => {
    prismaMock.conversation.findFirst.mockResolvedValueOnce({
      leadId: 'lead-x',
    });
    prismaMock.lead.update.mockResolvedValueOnce({ id: 'lead-x' });

    const res = await exec(tools().captureLead, { nome: 'Maria' });

    expect(prismaMock.lead.create).not.toHaveBeenCalled();
    expect(prismaMock.lead.update).toHaveBeenCalled();
    expect(res.leadId).toBe('lead-x');
  });

  it('bookAppointment: cria appointment e marca conversa como agendada', async () => {
    prismaMock.conversation.findFirst.mockResolvedValueOnce({
      leadId: 'lead-1',
    }); // lookup do leadId
    // O agendamento resolve o procedimento com `findFirst` porque precisa da
    // duração (tamanho do horário a reservar), não da visão formatada (F9).
    prismaMock.procedure.findFirst.mockResolvedValueOnce({
      id: 'p1',
      name: 'Implante',
      durationMinutes: 60,
    });
    prismaMock.appointment.create.mockResolvedValueOnce({ id: 'appt-1' });
    conversationsMock.markAsScheduled.mockResolvedValueOnce({});

    const res = await exec(tools().bookAppointment, {
      procedimento: 'implante',
      preferencia: 'quinta de manhã',
    });

    expect(res).toEqual(
      expect.objectContaining({
        ok: true,
        appointmentId: 'appt-1',
        // Sem agenda conectada o horário não é reservado — e a tool diz isso
        // ao modelo para que ele não confirme o que não existe (F9).
        confirmado: false,
      }),
    );
    expect(prismaMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clinicId: CLINIC_ID,
          conversationId: CONVERSATION_ID,
          leadId: 'lead-1',
          procedureId: 'p1',
          preferredTime: 'quinta de manhã',
        }),
      }),
    );
    expect(conversationsMock.markAsScheduled).toHaveBeenCalledWith(
      CONVERSATION_ID,
      CLINIC_ID,
    );
  });

  it('bookAppointment: agenda mesmo se a transição de status falhar', async () => {
    prismaMock.conversation.findFirst.mockResolvedValueOnce({ leadId: null });
    prismaMock.appointment.create.mockResolvedValueOnce({ id: 'appt-2' });
    conversationsMock.markAsScheduled.mockRejectedValueOnce(
      new Error('transição inválida'),
    );

    const res = await exec(tools().bookAppointment, { preferencia: 'amanhã' });

    expect(res).toEqual(
      expect.objectContaining({ ok: true, appointmentId: 'appt-2' }),
    );
  });

  it('presentOffer: oferta do procedimento nomeado + empurra a mídia no coletor (F6)', async () => {
    prismaMock.procedure.findFirst.mockResolvedValueOnce({
      name: 'Clareamento',
      offerText: '20% off neste mês',
      offerMediaUrl: 'https://cdn/promo.jpg',
      offerMediaType: 'image',
    });
    const attachments: unknown[] = [];

    const res = await exec(tools(attachments).presentOffer, {
      procedimento: 'clareamento',
    });

    expect(res).toMatchObject({
      ok: true,
      oferta: '20% off neste mês',
      enviandoMidia: true,
      tipoMidia: 'image',
    });
    expect(attachments).toEqual([
      { url: 'https://cdn/promo.jpg', type: 'image' },
    ]);
  });

  it('presentOffer: por interesse casa a tag e escolhe procedimento com oferta', async () => {
    // Limpa a fila de `once` (clearAllMocks não a esvazia entre testes).
    prismaMock.procedure.findMany.mockReset();
    prismaMock.tag.findMany.mockReset();
    prismaMock.tag.findMany.mockResolvedValueOnce([
      { id: 't1', name: 'estética', keywords: ['dente amarelo'] },
    ]);
    prismaMock.procedure.findMany.mockResolvedValueOnce([
      {
        name: 'Faceta',
        offerText: null,
        offerMediaUrl: null,
        offerMediaType: null,
      },
      {
        name: 'Clareamento',
        offerText: 'Avaliação grátis',
        offerMediaUrl: null,
        offerMediaType: null,
      },
    ]);

    const res = await exec(tools().presentOffer, {
      interesse: 'meu dente amarelo me incomoda',
    });

    expect(res).toMatchObject({
      ok: true,
      oferta: 'Avaliação grátis',
      enviandoMidia: false,
    });
  });

  it('presentOffer: sem oferta específica, cai na oferta global ativa', async () => {
    prismaMock.procedure.findFirst.mockResolvedValueOnce(null);
    prismaMock.clinicSettings.findUnique.mockResolvedValueOnce({
      offerEnabled: true,
      offerText: 'Primeira consulta grátis',
      offerMediaUrl: '',
      offerMediaType: null,
    });

    const res = await exec(tools().presentOffer, {
      procedimento: 'inexistente',
    });

    expect(res).toMatchObject({ ok: true, oferta: 'Primeira consulta grátis' });
  });

  it('presentOffer: nada a oferecer → ok:false', async () => {
    prismaMock.tag.findMany.mockResolvedValueOnce([]);
    prismaMock.clinicSettings.findUnique.mockResolvedValueOnce({
      offerEnabled: false,
      offerText: null,
      offerMediaUrl: null,
      offerMediaType: null,
    });

    const res = await exec(tools().presentOffer, {
      interesse: 'qualquer coisa',
    });

    expect(res.ok).toBe(false);
  });
});

/**
 * Profissional na conversa (F20): o que o cliente escreve chega às tools como
 * texto, e a tool decide — ou devolve as opções para o modelo perguntar.
 */
describe('buildChatTools — profissional (F20)', () => {
  const ana = {
    id: '00000000-0000-0000-0000-00000000000a',
    externalId: '10',
    name: 'Dra. Ana Ribeiro',
    active: true,
    unitExternalId: '1',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const bruno = {
    ...ana,
    id: '00000000-0000-0000-0000-00000000000b',
    externalId: '11',
    name: 'Dr. Bruno Lima',
  };

  const prismaMock = {
    procedure: { findMany: jest.fn(), findFirst: jest.fn() },
    tag: { findMany: jest.fn().mockResolvedValue([]) },
    clinicSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    conversation: { findFirst: jest.fn(), update: jest.fn() },
    lead: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    appointment: { create: jest.fn() },
  };
  const conversationsMock = { markAsScheduled: jest.fn() };
  const agendaMock = {
    timeZone: jest.fn().mockResolvedValue('America/Sao_Paulo'),
    getAvailability: jest.fn(),
    book: jest.fn(),
    resolveProfessional: jest.fn(),
    professionalByExternalId: jest.fn(),
  };

  function tools() {
    return buildChatTools({
      prisma: prismaMock,
      conversations: conversationsMock,
      clinicId: CLINIC_ID,
      conversationId: CONVERSATION_ID,
      agenda: agendaMock,
    } as unknown as ChatToolsContext);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.procedure.findFirst.mockResolvedValue(null);
    prismaMock.conversation.findFirst.mockResolvedValue({ leadId: 'lead-1' });
    prismaMock.lead.findFirst.mockResolvedValue({
      name: 'Maria',
      phone: '11999990000',
    });
    agendaMock.getAvailability.mockResolvedValue({
      live: true,
      slots: [
        {
          startsAt: '2026-10-01T13:00:00.000Z',
          endsAt: '2026-10-01T13:30:00.000Z',
          professionalId: '10',
          professionalName: 'Dra. Ana Ribeiro',
          unitId: '1',
        },
      ],
    });
    agendaMock.book.mockResolvedValue({
      appointmentId: 'appt-1',
      startsAt: new Date('2026-10-01T13:00:00.000Z'),
      confirmed: true,
      externalId: 'ext-1',
      failureKind: null,
    });
  });

  it('checkAvailability: nome do cliente vira o profissional da consulta e cada horário diz com quem é', async () => {
    agendaMock.resolveProfessional.mockResolvedValueOnce({
      kind: 'um',
      professional: ana,
    });

    const res = await exec(tools().checkAvailability, {
      profissional: 'dra ana',
    });

    expect(agendaMock.resolveProfessional).toHaveBeenCalledWith(
      CLINIC_ID,
      'dra ana',
    );
    expect(agendaMock.getAvailability).toHaveBeenCalledWith(
      CLINIC_ID,
      expect.objectContaining({ professionalId: '10' }),
    );
    expect(res.horarios[0]).toMatchObject({
      profissional: 'Dra. Ana Ribeiro',
      profissionalId: '10',
    });
  });

  it('checkAvailability: nome ambíguo não consulta nada — devolve as opções para o modelo perguntar', async () => {
    agendaMock.resolveProfessional.mockResolvedValueOnce({
      kind: 'ambiguo',
      options: [ana, { ...bruno, name: 'Ana Clara' }],
    });

    const res = await exec(tools().checkAvailability, { profissional: 'Ana' });

    expect(agendaMock.getAvailability).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      agendaConectada: true,
      horarios: [],
      profissionalAmbiguo: ['Dra. Ana Ribeiro', 'Ana Clara'],
    });
    expect(res.orientacao).toContain('Pergunte');
  });

  it('checkAvailability: nome desconhecido orienta a listar a equipe, sem inventar', async () => {
    agendaMock.resolveProfessional.mockResolvedValueOnce({ kind: 'nenhum' });

    const res = await exec(tools().checkAvailability, {
      profissional: 'Dr. House',
    });

    expect(agendaMock.getAvailability).not.toHaveBeenCalled();
    expect(res.horarios).toEqual([]);
    expect(res.orientacao).toContain('Nenhum profissional');
  });

  it('checkAvailability: cadastro manual não vira consulta irrestrita na agenda', async () => {
    agendaMock.resolveProfessional.mockResolvedValueOnce({
      kind: 'um',
      professional: { ...ana, externalId: '' },
    });

    const res = await exec(tools().checkAvailability, {
      profissional: 'Dra. Ana',
    });

    expect(agendaMock.getAvailability).not.toHaveBeenCalled();
    expect(res.orientacao).toContain('não está vinculado');
  });

  it('checkAvailability: sem profissional, consulta sem restrição (política do dono decide o tom)', async () => {
    await exec(tools().checkAvailability, {});

    expect(agendaMock.resolveProfessional).not.toHaveBeenCalled();
    expect(agendaMock.getAvailability).toHaveBeenCalledWith(
      CLINIC_ID,
      expect.objectContaining({ professionalId: null }),
    );
  });

  it('bookAppointment: o profissionalId do horário escolhido vai para a agenda', async () => {
    agendaMock.professionalByExternalId.mockResolvedValueOnce(bruno);

    await exec(tools().bookAppointment, {
      dataHora: '2026-10-01T10:00',
      profissionalId: '11',
    });

    expect(agendaMock.professionalByExternalId).toHaveBeenCalledWith(
      CLINIC_ID,
      '11',
    );
    expect(agendaMock.book).toHaveBeenCalledWith(
      CLINIC_ID,
      expect.objectContaining({ professional: bruno }),
    );
  });

  it('bookAppointment: sem id, o nome digitado casa com a equipe; ambíguo para antes de agendar', async () => {
    agendaMock.resolveProfessional.mockResolvedValueOnce({
      kind: 'um',
      professional: ana,
    });
    await exec(tools().bookAppointment, { profissional: 'ana' });
    expect(agendaMock.book).toHaveBeenLastCalledWith(
      CLINIC_ID,
      expect.objectContaining({ professional: ana }),
    );

    agendaMock.resolveProfessional.mockResolvedValueOnce({
      kind: 'ambiguo',
      options: [ana, bruno],
    });
    const callsBefore = agendaMock.book.mock.calls.length;
    const res = await exec(tools().bookAppointment, { profissional: 'dr' });

    expect(res).toMatchObject({ ok: false });
    expect(res.erro).toContain('Mais de um profissional');
    expect(agendaMock.book).toHaveBeenCalledTimes(callsBefore);
  });

  it('bookAppointment: falha ao resolver o profissional não troca silenciosamente pelo padrão', async () => {
    agendaMock.professionalByExternalId.mockRejectedValueOnce(
      new Error('banco fora'),
    );

    const res = await exec(tools().bookAppointment, {
      profissionalId: '11',
    });

    expect(res).toMatchObject({ ok: false });
    expect(res.erro).toContain('confirmar o profissional');
    expect(agendaMock.book).not.toHaveBeenCalled();
  });

  it('bookAppointment: id que deixou de existir pede nova consulta', async () => {
    agendaMock.professionalByExternalId.mockResolvedValueOnce(null);

    const res = await exec(tools().bookAppointment, {
      profissionalId: '11',
    });

    expect(res).toMatchObject({ ok: false });
    expect(res.erro).toContain('não está mais disponível');
    expect(agendaMock.book).not.toHaveBeenCalled();
  });
});
