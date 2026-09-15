import { type ChatToolsContext, buildChatTools } from './tools';

const CLINIC_ID = '00000000-0000-0000-0000-0000000c1141';
const CONVERSATION_ID = '22222222-2222-2222-2222-222222222222';
const LEAD_ID = '33333333-3333-3333-3333-333333333333';
const APPOINTMENT_ID = '44444444-4444-4444-4444-444444444444';

/** Sexta-feira, 18/09/2026, 17:00 em São Paulo. */
const STARTS_AT = new Date('2026-09-18T20:00:00.000Z');

function exec(tool: unknown, input: unknown): Promise<any> {
  const fn = (tool as { execute: (i: unknown, o: unknown) => Promise<unknown> })
    .execute;
  return fn(input, {}) as Promise<any>;
}

/**
 * Desmarcar pelo agente (F14).
 *
 * O defeito que estas tools fecham: o cliente escrevia "não vou conseguir ir
 * hoje", o modelo respondia "tudo bem, já cancelei para você" — e **nada era
 * cancelado**. O horário seguia ocupado na agenda da empresa, os lembretes
 * continuavam programados e alguém esperava o cliente. Um agente que promete
 * uma ação que não executa é pior do que um que diz não saber fazer.
 */
describe('tools de cancelamento (F14)', () => {
  const prismaMock = {
    procedure: { findFirst: jest.fn(), findMany: jest.fn() },
    tag: { findMany: jest.fn().mockResolvedValue([]) },
    clinicSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    conversation: { findFirst: jest.fn(), update: jest.fn() },
    lead: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    appointment: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  };
  const conversationsMock = { markAsScheduled: jest.fn() };
  const agendaMock = {
    cancel: jest.fn(),
    timeZone: jest.fn().mockResolvedValue('America/Sao_Paulo'),
  };

  function tools(withAgenda = true) {
    return buildChatTools({
      prisma: prismaMock,
      conversations: conversationsMock,
      clinicId: CLINIC_ID,
      conversationId: CONVERSATION_ID,
      channel: 'whatsapp',
      ...(withAgenda ? { agenda: agendaMock } : {}),
    } as unknown as ChatToolsContext);
  }

  const appointmentRow = {
    id: APPOINTMENT_ID,
    status: 'agendado',
    startsAt: STARTS_AT,
    preferredTime: null,
    procedure: { name: 'Limpeza' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    agendaMock.timeZone.mockResolvedValue('America/Sao_Paulo');
    prismaMock.conversation.findFirst.mockResolvedValue({ leadId: LEAD_ID });
    prismaMock.appointment.findMany.mockResolvedValue([appointmentRow]);
  });

  describe('findMyAppointments', () => {
    it('busca só o que é deste contato — lead da conversa ou a própria conversa', async () => {
      await exec(tools().findMyAppointments, {});

      const where = prismaMock.appointment.findMany.mock.calls[0][0].where;
      expect(where.clinicId).toBe(CLINIC_ID);
      expect(where.OR).toEqual([
        { leadId: LEAD_ID },
        { conversationId: CONVERSATION_ID },
      ]);
      // Telefone **não** entra no escopo: o celular da família é compartilhado,
      // e casar por ele deixaria o agente desmarcar a consulta de outra pessoa.
      expect(JSON.stringify(where)).not.toContain('phone');
    });

    it('sem lead vinculado, o escopo é só a conversa', async () => {
      prismaMock.conversation.findFirst.mockResolvedValueOnce({ leadId: null });

      await exec(tools().findMyAppointments, {});

      const where = prismaMock.appointment.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ conversationId: CONVERSATION_ID }]);
    });

    it('só estados de pé, e inclui o pedido sem horário reservado', async () => {
      await exec(tools().findMyAppointments, {});

      const where = prismaMock.appointment.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({
        in: ['pedido', 'agendado', 'confirmado'],
      });
      expect(where.AND[0].OR).toContainEqual({ startsAt: null });
    });

    it('devolve o horário em português, com o id que a outra tool exige', async () => {
      const res = await exec(tools().findMyAppointments, {});

      expect(res.agendamentos).toHaveLength(1);
      expect(res.agendamentos[0].agendamentoId).toBe(APPOINTMENT_ID);
      expect(res.agendamentos[0].quando).toBe('sexta-feira, 18/09 às 17:00');
      expect(res.agendamentos[0].procedimento).toBe('Limpeza');
    });

    it('pedido sem horário mostra a preferência em texto livre', async () => {
      prismaMock.appointment.findMany.mockResolvedValueOnce([
        {
          ...appointmentRow,
          startsAt: null,
          preferredTime: 'terça de manhã',
          status: 'pedido',
        },
      ]);

      const res = await exec(tools().findMyAppointments, {});

      expect(res.agendamentos[0].quando).toBe('terça de manhã');
    });

    it('lista vazia proíbe explicitamente afirmar o cancelamento', async () => {
      prismaMock.appointment.findMany.mockResolvedValueOnce([]);

      const res = await exec(tools().findMyAppointments, {});

      expect(res.agendamentos).toEqual([]);
      expect(res.orientacao).toMatch(/não afirme que cancelou/i);
    });
  });

  describe('cancelAppointment', () => {
    it('cancela de verdade na agenda e só então confirma', async () => {
      agendaMock.cancel.mockResolvedValueOnce({ id: APPOINTMENT_ID });

      const res = await exec(tools().cancelAppointment, {
        agendamentoId: APPOINTMENT_ID,
      });

      expect(agendaMock.cancel).toHaveBeenCalledWith(CLINIC_ID, APPOINTMENT_ID);
      expect(res.ok).toBe(true);
      expect(res.quando).toBe('sexta-feira, 18/09 às 17:00');
    });

    it('**id de outro contato é recusado** — a checagem que importa', async () => {
      // O id chega como texto gerado por um modelo a partir do que o cliente
      // escreveu: entrada não confiável por definição. A lista do próprio
      // contato é a fronteira.
      const res = await exec(tools().cancelAppointment, {
        agendamentoId: '99999999-9999-9999-9999-999999999999',
      });

      expect(agendaMock.cancel).not.toHaveBeenCalled();
      expect(res).toMatchObject({ ok: false, motivo: 'nao_encontrado' });
      expect(res.orientacao).toMatch(/não diga que cancelou/i);
    });

    it('id vazio ou inventado não chega na agenda', async () => {
      const res = await exec(tools().cancelAppointment, {
        agendamentoId: '  ',
      });

      expect(agendaMock.cancel).not.toHaveBeenCalled();
      expect(res.ok).toBe(false);
    });

    it('agenda fora do ar → ok:false e a instrução de NÃO prometer', async () => {
      // Este é o caminho que reproduz o defeito original se for tratado errado:
      // o horário continua ocupado, então dizer "cancelei" seria mentir de novo.
      agendaMock.cancel.mockRejectedValueOnce(new Error('503 do provedor'));

      const res = await exec(tools().cancelAppointment, {
        agendamentoId: APPOINTMENT_ID,
      });

      expect(res).toMatchObject({ ok: false, motivo: 'agenda_indisponivel' });
      expect(res.orientacao).toMatch(/continua marcado/i);
    });

    it('sem agenda conectada, cancela ao menos o registro local', async () => {
      prismaMock.appointment.updateMany.mockResolvedValueOnce({ count: 1 });

      const res = await exec(tools(false).cancelAppointment, {
        agendamentoId: APPOINTMENT_ID,
      });

      expect(prismaMock.appointment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: APPOINTMENT_ID,
            clinicId: CLINIC_ID,
          }),
          data: expect.objectContaining({ status: 'cancelado' }),
        }),
      );
      expect(res.ok).toBe(true);
    });
  });
});
