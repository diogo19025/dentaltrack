import { LeadPrivacyService } from './lead-privacy.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const LEAD = '11111111-1111-1111-1111-111111111111';
const PHONE = '(11) 90000-0000';
/** Mesma forma normalizada que o envio usa. */
const NORMALIZED = '5511900000000';

const ANONIMIZADO_EM = new Date('2026-09-11T10:00:00.000Z');

function setup() {
  const prisma = {
    lead: { findFirst: jest.fn(), update: jest.fn() },
    conversation: {
      updateMany: jest.fn(),
      // Conversas do titular — por vínculo **ou** por telefone.
      findMany: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]),
    },
    message: { updateMany: jest.fn() },
    appointment: { updateMany: jest.fn() },
    outboundMessage: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const optOut = {
    isOptedOut: jest.fn().mockResolvedValue(false),
    optOut: jest.fn().mockResolvedValue(undefined),
    optIn: jest.fn().mockResolvedValue(undefined),
  };
  const service = new LeadPrivacyService(prisma as never, optOut as never);
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  return { service, prisma, optOut };
}

const leadRow = (over: Record<string, unknown> = {}) => ({
  id: LEAD,
  phone: PHONE,
  anonymizedAt: null,
  ...over,
});

describe('LeadPrivacyService (P1.5)', () => {
  describe('anonymize', () => {
    it('limpa nome, telefone, e-mail e o id do sistema de gestão', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());

      await service.anonymize(CLINIC, LEAD);

      const data = prisma.lead.update.mock.calls[0][0].data;
      expect(data).toMatchObject({
        phone: null,
        email: null,
        externalId: null,
      });
      expect(data.anonymizedAt).toBeInstanceOf(Date);
    });

    it('apaga a identidade do canal nas conversas do titular', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());

      await service.anonymize(CLINIC, LEAD);

      expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { clinicId: CLINIC, id: { in: ['c1', 'c2'] } },
        data: { contactPhone: null },
      });
    });

    /**
     * A falha que este teste guarda: buscar as conversas só por `leadId`
     * deixava intactas as que carregam o telefone do contato sem vínculo — o
     * que ele escreveu **antes** de virar lead, ou numa conversa que ficou
     * órfã. Ali ficavam a identidade do canal e o conteúdo das mensagens.
     */
    it('alcança conversa que tem o telefone mas não o vínculo', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());

      await service.anonymize(CLINIC, LEAD);

      const where = prisma.conversation.findMany.mock.calls[0][0].where;
      expect(where.clinicId).toBe(CLINIC);
      expect(where.OR).toEqual([
        { leadId: LEAD },
        { contactPhone: { in: [PHONE, NORMALIZED] } },
      ]);
    });

    it('substitui o conteúdo das mensagens de todas essas conversas', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());
      prisma.conversation.findMany.mockResolvedValueOnce([
        { id: 'c1' },
        { id: 'sem-vinculo' },
      ]);

      await service.anonymize(CLINIC, LEAD);

      const call = prisma.message.updateMany.mock.calls[0][0];
      expect(call.where.conversationId).toEqual({
        in: ['c1', 'sem-vinculo'],
      });
      expect(call.where.clinicId).toBe(CLINIC);
      expect(call.data.content).toContain('removido');
    });

    /**
     * `preferredTime` é texto livre do cliente ("terça de manhã, é para o meu
     * filho João") e volta para o system prompt do agente em `ai/prompt.ts` —
     * preservar a linha do agendamento não pode significar preservar a fala.
     */
    it('limpa a preferência de horário sem apagar o agendamento', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());

      await service.anonymize(CLINIC, LEAD);

      const call = prisma.appointment.updateMany.mock.calls[0][0];
      expect(call.data).toEqual({ preferredTime: null });
      expect(call.where.OR).toEqual([
        { leadId: LEAD },
        { conversationId: { in: ['c1', 'c2'] } },
      ]);
    });

    it('limpa corpo e telefone das mensagens de saída, com ou sem vínculo', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());

      await service.anonymize(CLINIC, LEAD);

      const call = prisma.outboundMessage.updateMany.mock.calls[0][0];
      expect(call.where.clinicId).toBe(CLINIC);
      expect(call.where.OR).toEqual([
        { leadId: LEAD },
        { phone: { in: [PHONE, NORMALIZED] } },
      ]);
      expect(call.data.phone).toBeNull();
    });

    /** Tudo ou nada: um lead sem nome com o telefone ainda nas mensagens é pior. */
    it('escreve tudo numa transação só', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());

      await service.anonymize(CLINIC, LEAD);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(5);
    });

    it('cancela o que ainda não saiu para aquele telefone', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());

      await service.anonymize(CLINIC, LEAD);

      // A última chamada é a de fora da transação, por telefone normalizado.
      const calls = prisma.outboundMessage.updateMany.mock.calls;
      const cleanup = calls[calls.length - 1][0];
      expect(cleanup.where).toMatchObject({
        clinicId: CLINIC,
        phone: NORMALIZED,
        status: 'pendente',
      });
      expect(cleanup.data.status).toBe('cancelado');
    });

    /**
     * O telefone descadastrado é justamente o que impede reenviar mensagem
     * para quem pediu para parar. Apagá-lo em nome da privacidade produziria a
     * violação que ele previne.
     */
    it('NÃO remove o descadastro — ele é o que protege o contato', async () => {
      const { service, prisma, optOut } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());
      optOut.isOptedOut.mockResolvedValue(true);

      const state = await service.anonymize(CLINIC, LEAD);

      expect(optOut.optIn).not.toHaveBeenCalled();
      expect(state.optedOut).toBe(true);
    });

    it('anonimizar duas vezes não escreve de novo', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(
        leadRow({ anonymizedAt: ANONIMIZADO_EM, phone: null }),
      );

      const state = await service.anonymize(CLINIC, LEAD);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(state.anonymizedAt).toBe(ANONIMIZADO_EM.toISOString());
    });

    it('lead sem telefone busca as conversas só pelo vínculo', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow({ phone: null }));

      await expect(service.anonymize(CLINIC, LEAD)).resolves.toMatchObject({
        leadId: LEAD,
      });

      expect(prisma.conversation.findMany.mock.calls[0][0].where.OR).toEqual([
        { leadId: LEAD },
      ]);
      // Só a chamada de dentro da transação, sem a limpeza por telefone.
      expect(prisma.outboundMessage.updateMany).toHaveBeenCalledTimes(1);
    });

    it('lead de outra empresa → 404', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(null);

      await expect(service.anonymize(CLINIC, LEAD)).rejects.toMatchObject({
        status: 404,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('setOptOut', () => {
    it('descadastra o telefone do lead', async () => {
      const { service, prisma, optOut } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());
      optOut.isOptedOut.mockResolvedValue(true);

      const state = await service.setOptOut(CLINIC, LEAD, true);

      expect(optOut.optOut).toHaveBeenCalledWith(
        CLINIC,
        PHONE,
        expect.any(String),
      );
      expect(state.optedOut).toBe(true);
    });

    it('reativa quando pedido', async () => {
      const { service, prisma, optOut } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(leadRow());

      const state = await service.setOptOut(CLINIC, LEAD, false);

      expect(optOut.optIn).toHaveBeenCalledWith(CLINIC, PHONE);
      expect(optOut.optOut).not.toHaveBeenCalled();
      expect(state.optedOut).toBe(false);
    });

    it('lead de outra empresa → 404', async () => {
      const { service, prisma } = setup();
      prisma.lead.findFirst.mockResolvedValueOnce(null);

      await expect(service.setOptOut(CLINIC, LEAD, true)).rejects.toMatchObject(
        { status: 404 },
      );
    });
  });
});
