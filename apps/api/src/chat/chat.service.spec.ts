import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ServerResponse } from 'node:http';

// Mocka só a geração streaming (sem rede); o resto do generate-reply é real.
jest.mock('../ai/generate-reply', () => {
  const actual = jest.requireActual<typeof import('../ai/generate-reply')>(
    '../ai/generate-reply',
  );
  return { ...actual, streamAssistantReply: jest.fn() };
});
import {
  type StreamReplyOptions,
  streamAssistantReply,
} from '../ai/generate-reply';
import { ChatService } from './chat.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../prisma/prisma.service';

const streamMock = streamAssistantReply as jest.MockedFunction<
  typeof streamAssistantReply
>;

const CLINIC_ID = '00000000-0000-0000-0000-0000000c1141';
const CONVERSATION_ID = '22222222-2222-2222-2222-222222222222';

/** Fake ServerResponse: só o que o adapter toca. */
function makeRes(): ServerResponse {
  return {
    headersSent: false,
    setHeader: jest.fn(),
    end: jest.fn(),
    write: jest.fn(),
  } as unknown as ServerResponse;
}

describe('ChatService.streamMessage', () => {
  let service: ChatService;
  const pipeMock = jest.fn();
  let onFinish: StreamReplyOptions['onFinish'];

  const conversationsMock = {
    createConversation: jest.fn(),
    appendMessage: jest.fn(),
    getConversation: jest.fn(),
  };
  const prismaMock = {
    conversation: { findFirst: jest.fn() },
    clinic: { findUnique: jest.fn() },
    clinicSettings: { findUnique: jest.fn() },
    procedure: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    onFinish = undefined;
    // Captura o onFinish e devolve um resultado "pipável".
    streamMock.mockImplementation((_messages, _system, _tools, options) => {
      onFinish = options?.onFinish;
      return { pipeUIMessageStreamToResponse: pipeMock };
    });
    conversationsMock.appendMessage.mockResolvedValue({ id: 'msg' });
    // Defaults do buildPrompt (clínica existe, sem settings/procedimentos).
    prismaMock.clinic.findUnique.mockResolvedValue({
      id: CLINIC_ID,
      name: 'Clínica Demo',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prismaMock.clinicSettings.findUnique.mockResolvedValue(null);
    prismaMock.procedure.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ConversationsService, useValue: conversationsMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(ChatService);
  });

  it('sem conversationId: abre conversa na clínica, persiste user, streama e devolve o header', async () => {
    conversationsMock.createConversation.mockResolvedValueOnce({
      id: CONVERSATION_ID,
    });
    conversationsMock.getConversation.mockResolvedValueOnce({
      messages: [{ role: 'user', content: 'Olá' }],
    });
    const res = makeRes();

    await service.streamMessage({ message: 'Olá' }, CLINIC_ID, res);

    expect(conversationsMock.createConversation).toHaveBeenCalledWith(
      CLINIC_ID,
    );
    // user persistido ANTES do stream (escopado no clinicId do tenant).
    expect(conversationsMock.appendMessage).toHaveBeenNthCalledWith(
      1,
      CONVERSATION_ID,
      'user',
      'Olá',
      {},
      CLINIC_ID,
    );
    // streamAssistantReply recebe histórico (só user/assistant) + system da clínica + tools.
    expect(streamMock).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Olá' }],
      expect.stringContaining('Clínica Demo'),
      expect.objectContaining({
        captureLead: expect.anything(),
        bookAppointment: expect.anything(),
      }),
      expect.objectContaining({
        onFinish: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    // pipe chamado com o conversationId no header.
    expect(pipeMock).toHaveBeenCalledWith(
      res,
      expect.objectContaining({
        headers: { 'X-Conversation-Id': CONVERSATION_ID },
      }),
    );
  });

  it('onFinish persiste a resposta do assistant com os tokens', async () => {
    conversationsMock.createConversation.mockResolvedValueOnce({
      id: CONVERSATION_ID,
    });
    conversationsMock.getConversation.mockResolvedValueOnce({
      messages: [{ role: 'user', content: 'Olá' }],
    });

    await service.streamMessage({ message: 'Olá' }, CLINIC_ID, makeRes());
    // Simula o fim do stream.
    await onFinish?.({ text: 'Resposta da IA.', tokens: 42 });

    expect(conversationsMock.appendMessage).toHaveBeenNthCalledWith(
      2,
      CONVERSATION_ID,
      'assistant',
      'Resposta da IA.',
      { tokens: 42 },
      CLINIC_ID,
    );
  });

  it('onFinish com texto vazio não persiste assistant', async () => {
    conversationsMock.createConversation.mockResolvedValueOnce({
      id: CONVERSATION_ID,
    });
    conversationsMock.getConversation.mockResolvedValueOnce({
      messages: [{ role: 'user', content: 'Olá' }],
    });

    await service.streamMessage({ message: 'Olá' }, CLINIC_ID, makeRes());
    await onFinish?.({ text: '', tokens: undefined });

    // só o append do user.
    expect(conversationsMock.appendMessage).toHaveBeenCalledTimes(1);
  });

  it('com conversationId da clínica: valida o escopo e não cria nova conversa', async () => {
    prismaMock.conversation.findFirst.mockResolvedValueOnce({
      id: CONVERSATION_ID,
    });
    conversationsMock.getConversation.mockResolvedValueOnce({
      messages: [{ role: 'user', content: 'Oi' }],
    });

    await service.streamMessage(
      { conversationId: CONVERSATION_ID, message: 'Oi' },
      CLINIC_ID,
      makeRes(),
    );

    expect(prismaMock.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, clinicId: CLINIC_ID },
      select: { id: true },
    });
    expect(conversationsMock.createConversation).not.toHaveBeenCalled();
    expect(pipeMock).toHaveBeenCalled();
  });

  it("filtra mensagens 'system' do histórico enviado à IA", async () => {
    conversationsMock.createConversation.mockResolvedValueOnce({
      id: CONVERSATION_ID,
    });
    conversationsMock.getConversation.mockResolvedValueOnce({
      messages: [
        { role: 'system', content: 'prompt interno' },
        { role: 'user', content: 'Olá' },
      ],
    });

    await service.streamMessage({ message: 'Olá' }, CLINIC_ID, makeRes());

    expect(streamMock).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Olá' }],
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('conversationId de outra clínica (ou inexistente) → 404, sem streamar nem persistir', async () => {
    prismaMock.conversation.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.streamMessage(
        { conversationId: CONVERSATION_ID, message: 'Oi' },
        CLINIC_ID,
        makeRes(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(streamMock).not.toHaveBeenCalled();
    expect(conversationsMock.appendMessage).not.toHaveBeenCalled();
  });
});
