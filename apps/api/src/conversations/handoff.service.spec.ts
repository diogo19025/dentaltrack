import { HandoffService } from './handoff.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const CONVERSATION = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';

const ASSUMIDA_EM = new Date('2026-09-10T14:32:00.000Z');

function setup() {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({
        handoffAt: ASSUMIDA_EM,
        handoffReason: null,
      }),
    },
  };
  const service = new HandoffService(prisma as never);
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  return { service, prisma };
}

/** Estado normal: a IA responde, num canal onde o handoff existe. */
const comIa = {
  handoffAt: null,
  handoffReason: null,
  channel: 'whatsapp' as const,
};

describe('HandoffService (P0.2)', () => {
  describe('assume', () => {
    it('marca a data e quem assumiu; a IA para de responder', async () => {
      const { service, prisma } = setup();
      prisma.conversation.findFirst.mockResolvedValueOnce(comIa);

      const state = await service.assume(CLINIC, CONVERSATION, USER);

      const data = prisma.conversation.update.mock.calls[0][0].data;
      expect(data.handoffAt).toBeInstanceOf(Date);
      expect(data.handoffBy).toBe(USER);
      expect(state.handoffAt).toBe(ASSUMIDA_EM.toISOString());
    });

    it('guarda o motivo quando há um, e null quando é só espaço em branco', async () => {
      const { service, prisma } = setup();
      prisma.conversation.findFirst.mockResolvedValue(comIa);

      await service.assume(CLINIC, CONVERSATION, USER, '  Cliente irritado  ');
      expect(
        prisma.conversation.update.mock.calls[0][0].data.handoffReason,
      ).toBe('Cliente irritado');

      await service.assume(CLINIC, CONVERSATION, USER, '   ');
      expect(
        prisma.conversation.update.mock.calls[1][0].data.handoffReason,
      ).toBeNull();
    });

    /**
     * O relógio do handoff responde "há quanto tempo este cliente está
     * esperando gente?". Um duplo clique não pode zerá-lo.
     */
    it('assumir o que já está assumido não reinicia o relógio', async () => {
      const { service, prisma } = setup();
      prisma.conversation.findFirst.mockResolvedValueOnce({
        channel: 'whatsapp' as const,
        handoffAt: ASSUMIDA_EM,
        handoffReason: 'Cliente irritado',
      });

      const state = await service.assume(CLINIC, CONVERSATION, 'outro-usuario');

      expect(prisma.conversation.update).not.toHaveBeenCalled();
      expect(state).toEqual({
        conversationId: CONVERSATION,
        handoffAt: ASSUMIDA_EM.toISOString(),
        handoffReason: 'Cliente irritado',
      });
    });

    it('conversa de outra empresa não existe para este tenant', async () => {
      const { service, prisma } = setup();
      prisma.conversation.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.assume(CLINIC, CONVERSATION, USER),
      ).rejects.toMatchObject({ status: 404 });
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('usuário desconhecido não impede assumir — o que importa é a IA parar', async () => {
      const { service, prisma } = setup();
      prisma.conversation.findFirst.mockResolvedValueOnce(comIa);

      await service.assume(CLINIC, CONVERSATION, null);

      expect(
        prisma.conversation.update.mock.calls[0][0].data.handoffBy,
      ).toBeNull();
    });
    /**
     * A falha que este teste guarda: a tela oferecia "Assumir atendimento" em
     * conversa do chat web, onde o gate da IA não existe (`streamMessage` não
     * consulta `handoffAt`). O `handoffAt` era gravado, o badge dizia
     * "atendimento humano", o bot continuava respondendo — e a fila de saída
     * passava a suprimir mensagens por causa de um estado que não valia nada.
     */
    it('recusa conversa do chat web, onde a pausa não é aplicada', async () => {
      const { service, prisma } = setup();
      prisma.conversation.findFirst.mockResolvedValueOnce({
        ...comIa,
        channel: 'web' as const,
      });

      await expect(
        service.assume(CLINIC, CONVERSATION, USER),
      ).rejects.toMatchObject({ status: 422 });
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('limpa data, autor e motivo — a IA volta a responder', async () => {
      const { service, prisma } = setup();
      prisma.conversation.findFirst.mockResolvedValueOnce({
        channel: 'whatsapp' as const,
        handoffAt: ASSUMIDA_EM,
        handoffReason: 'Cliente irritado',
      });
      jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

      const state = await service.release(CLINIC, CONVERSATION);

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION },
        data: { handoffAt: null, handoffBy: null, handoffReason: null },
      });
      expect(state).toEqual({
        conversationId: CONVERSATION,
        handoffAt: null,
        handoffReason: null,
      });
    });

    it('devolver o que já está com a IA é sucesso, não erro', async () => {
      const { service, prisma } = setup();
      prisma.conversation.findFirst.mockResolvedValueOnce(comIa);

      const state = await service.release(CLINIC, CONVERSATION);

      expect(prisma.conversation.update).not.toHaveBeenCalled();
      expect(state.handoffAt).toBeNull();
    });

    it('conversa de outra empresa → 404', async () => {
      const { service, prisma } = setup();
      prisma.conversation.findFirst.mockResolvedValueOnce(null);

      await expect(service.release(CLINIC, CONVERSATION)).rejects.toMatchObject(
        { status: 404 },
      );
    });
  });
});
