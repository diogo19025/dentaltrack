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
    lead: { create: jest.fn(), update: jest.fn() },
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
    prismaMock.procedure.findMany.mockResolvedValueOnce([
      { id: 'p1', name: 'Implante', tags: [] },
    ]);
    prismaMock.appointment.create.mockResolvedValueOnce({ id: 'appt-1' });
    conversationsMock.markAsScheduled.mockResolvedValueOnce({});

    const res = await exec(tools().bookAppointment, {
      procedimento: 'implante',
      preferencia: 'quinta de manhã',
    });

    expect(res).toEqual({ ok: true, appointmentId: 'appt-1' });
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
    prismaMock.procedure.findMany.mockResolvedValueOnce([]);
    prismaMock.appointment.create.mockResolvedValueOnce({ id: 'appt-2' });
    conversationsMock.markAsScheduled.mockRejectedValueOnce(
      new Error('transição inválida'),
    );

    const res = await exec(tools().bookAppointment, { preferencia: 'amanhã' });

    expect(res).toEqual({ ok: true, appointmentId: 'appt-2' });
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
