import {
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ServerResponse } from 'node:http';

// Mocka as gerações (sem rede); o resto do generate-reply é real.
jest.mock('../ai/generate-reply', () => {
  const actual = jest.requireActual<typeof import('../ai/generate-reply')>(
    '../ai/generate-reply',
  );
  return {
    ...actual,
    streamAssistantReply: jest.fn(),
    generateAssistantReply: jest.fn(),
  };
});
// Mocka o STT (sem rede) — o motor real é testado em ai/transcribe.spec.ts.
jest.mock('../ai/transcribe', () => ({ transcribeAudio: jest.fn() }));
import {
  AiUnavailableError,
  generateAssistantReply,
  type StreamReplyOptions,
  streamAssistantReply,
} from '../ai/generate-reply';
import { transcribeAudio } from '../ai/transcribe';
import { ChatService } from './chat.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../prisma/prisma.service';

const streamMock = streamAssistantReply as jest.MockedFunction<
  typeof streamAssistantReply
>;
const generateMock = generateAssistantReply as jest.MockedFunction<
  typeof generateAssistantReply
>;
const transcribeMock = transcribeAudio as jest.MockedFunction<
  typeof transcribeAudio
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
    resolveByPhone: jest.fn(),
    ensureContactLead: jest.fn(),
  };
  const prismaMock = {
    conversation: { findFirst: jest.fn() },
    clinic: { findUnique: jest.fn() },
    clinicSettings: { findUnique: jest.fn() },
    procedure: { findMany: jest.fn() },
    appointment: { findMany: jest.fn().mockResolvedValue([]) },
    // F6: contagem de mensagens (1º contato → mídia de saudação).
    message: { count: jest.fn().mockResolvedValue(1) },
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

  describe('entrada por áudio (speech-to-text)', () => {
    const AUDIO_B64 = Buffer.from('audio-fake').toString('base64');
    const TRANSCRIPT = 'Quero agendar uma avaliação';

    it('transcreve (mediaType normalizado), persiste a transcrição como user e devolve X-Transcript', async () => {
      transcribeMock.mockResolvedValueOnce(TRANSCRIPT);
      conversationsMock.createConversation.mockResolvedValueOnce({
        id: CONVERSATION_ID,
      });
      conversationsMock.getConversation.mockResolvedValueOnce({
        messages: [{ role: 'user', content: TRANSCRIPT }],
      });
      const res = makeRes();

      await service.streamMessage(
        { audio: AUDIO_B64, audioType: 'audio/webm;codecs=opus' },
        CLINIC_ID,
        res,
      );

      expect(transcribeMock).toHaveBeenCalledWith(
        Buffer.from('audio-fake'),
        'audio/webm',
      );
      expect(conversationsMock.appendMessage).toHaveBeenNthCalledWith(
        1,
        CONVERSATION_ID,
        'user',
        TRANSCRIPT,
        {},
        CLINIC_ID,
      );
      // A IA recebe a transcrição como texto — o motor não conhece o áudio.
      expect(streamMock).toHaveBeenCalledWith(
        [{ role: 'user', content: TRANSCRIPT }],
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
      );
      expect(pipeMock).toHaveBeenCalledWith(
        res,
        expect.objectContaining({
          headers: {
            'X-Conversation-Id': CONVERSATION_ID,
            'X-Transcript': encodeURIComponent(TRANSCRIPT),
          },
        }),
      );
    });

    it('falha do STT → 503 (ServiceUnavailable), sem criar conversa nem persistir', async () => {
      transcribeMock.mockRejectedValueOnce(
        new AiUnavailableError(new Error('provider caiu')),
      );

      await expect(
        service.streamMessage(
          { audio: AUDIO_B64, audioType: 'audio/webm' },
          CLINIC_ID,
          makeRes(),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(conversationsMock.createConversation).not.toHaveBeenCalled();
      expect(conversationsMock.appendMessage).not.toHaveBeenCalled();
      expect(streamMock).not.toHaveBeenCalled();
    });

    it('transcrição vazia (áudio ininteligível) → 422, sem criar conversa nem persistir', async () => {
      transcribeMock.mockResolvedValueOnce('');

      await expect(
        service.streamMessage(
          { audio: AUDIO_B64, audioType: 'audio/webm' },
          CLINIC_ID,
          makeRes(),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(conversationsMock.createConversation).not.toHaveBeenCalled();
      expect(conversationsMock.appendMessage).not.toHaveBeenCalled();
      expect(streamMock).not.toHaveBeenCalled();
    });
  });

  // WA-2: núcleo non-streaming usado pelo adapter WhatsApp (identidade = telefone).
  describe('processInboundMessage (non-streaming)', () => {
    const PHONE = '5511999998888';

    it('resolve a conversa pelo telefone, persiste user, gera resposta e a retorna', async () => {
      conversationsMock.resolveByPhone.mockResolvedValueOnce({
        id: CONVERSATION_ID,
      });
      conversationsMock.getConversation.mockResolvedValueOnce({
        messages: [{ role: 'user', content: 'Quero agendar' }],
      });
      generateMock.mockResolvedValueOnce({ text: 'Claro!', tokens: 12 });

      const result = await service.processInboundMessage({
        clinicId: CLINIC_ID,
        channel: 'whatsapp',
        contactPhone: PHONE,
        contactName: 'João',
        message: 'Quero agendar',
      });

      // Identidade pelo telefone (não por conversationId do cliente).
      expect(conversationsMock.resolveByPhone).toHaveBeenCalledWith(
        CLINIC_ID,
        'whatsapp',
        PHONE,
      );
      // Captura automática do lead pelo contato do canal (telefone + pushName).
      expect(conversationsMock.ensureContactLead).toHaveBeenCalledWith(
        CONVERSATION_ID,
        CLINIC_ID,
        { phone: PHONE, name: 'João', source: 'whatsapp' },
      );
      // user persistido antes de gerar.
      expect(conversationsMock.appendMessage).toHaveBeenNthCalledWith(
        1,
        CONVERSATION_ID,
        'user',
        'Quero agendar',
        {},
        CLINIC_ID,
      );
      // Geração non-streaming com histórico + system da clínica + tools.
      expect(generateMock).toHaveBeenCalledWith(
        [{ role: 'user', content: 'Quero agendar' }],
        expect.stringContaining('Clínica Demo'),
        expect.objectContaining({
          captureLead: expect.anything(),
          bookAppointment: expect.anything(),
        }),
      );
      // Resposta do bot persistida.
      expect(conversationsMock.appendMessage).toHaveBeenNthCalledWith(
        2,
        CONVERSATION_ID,
        'assistant',
        'Claro!',
        { tokens: 12 },
        CLINIC_ID,
      );
      expect(streamMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        conversationId: CONVERSATION_ID,
        reply: 'Claro!',
        transcript: undefined,
        attachments: [],
      });
    });

    it('primeiro contato: inclui a mídia de saudação (F6) nos anexos', async () => {
      conversationsMock.resolveByPhone.mockResolvedValueOnce({
        id: CONVERSATION_ID,
      });
      conversationsMock.getConversation.mockResolvedValueOnce({
        messages: [{ role: 'user', content: 'Oi' }],
      });
      // 1º turno (nenhuma mensagem ainda) → dispara a mídia de saudação.
      prismaMock.message.count.mockResolvedValueOnce(0);
      prismaMock.clinicSettings.findUnique.mockResolvedValue({
        greetingMediaUrl: 'https://cdn/welcome.jpg',
        greetingMediaType: 'image',
      });
      generateMock.mockResolvedValueOnce({ text: 'Bem-vindo!', tokens: 5 });

      const result = await service.processInboundMessage({
        clinicId: CLINIC_ID,
        channel: 'whatsapp',
        contactPhone: PHONE,
        message: 'Oi',
      });

      expect(result.attachments).toEqual([
        { url: 'https://cdn/welcome.jpg', type: 'image' },
      ]);
    });

    it('transcreve áudio e devolve a transcrição junto da resposta', async () => {
      const TRANSCRIPT = 'Tenho dor de dente';
      transcribeMock.mockResolvedValueOnce(TRANSCRIPT);
      conversationsMock.resolveByPhone.mockResolvedValueOnce({
        id: CONVERSATION_ID,
      });
      conversationsMock.getConversation.mockResolvedValueOnce({
        messages: [{ role: 'user', content: TRANSCRIPT }],
      });
      generateMock.mockResolvedValueOnce({ text: 'Sinto muito!', tokens: 5 });

      const result = await service.processInboundMessage({
        clinicId: CLINIC_ID,
        channel: 'whatsapp',
        contactPhone: PHONE,
        audio: Buffer.from('ptt').toString('base64'),
        audioType: 'audio/ogg;codecs=opus',
      });

      expect(transcribeMock).toHaveBeenCalledWith(
        Buffer.from('ptt'),
        'audio/ogg',
      );
      expect(conversationsMock.appendMessage).toHaveBeenNthCalledWith(
        1,
        CONVERSATION_ID,
        'user',
        TRANSCRIPT,
        {},
        CLINIC_ID,
      );
      expect(result.reply).toBe('Sinto muito!');
      expect(result.transcript).toBe(TRANSCRIPT);
    });

    it('contato conhecido (lead vinculado): injeta nome/telefone e recorrência no system prompt', async () => {
      conversationsMock.resolveByPhone.mockResolvedValueOnce({
        id: CONVERSATION_ID,
      });
      conversationsMock.getConversation.mockResolvedValueOnce({
        messages: [{ role: 'user', content: 'Oi, quero marcar de novo' }],
      });
      // loadKnownContact: conversa com lead já capturado em sessão anterior.
      prismaMock.conversation.findFirst.mockResolvedValueOnce({
        channel: 'whatsapp',
        contactPhone: PHONE,
        lead: {
          id: 'lead-1',
          name: 'João Silva',
          phone: PHONE,
          email: null,
        },
      });
      prismaMock.appointment.findMany.mockResolvedValueOnce([
        {
          createdAt: new Date(),
          preferredTime: 'sexta de manhã',
          procedure: { name: 'Clareamento' },
        },
      ]);
      generateMock.mockResolvedValueOnce({ text: 'Oi, João!', tokens: 3 });

      await service.processInboundMessage({
        clinicId: CLINIC_ID,
        channel: 'whatsapp',
        contactPhone: PHONE,
        message: 'Oi, quero marcar de novo',
      });

      const system = generateMock.mock.calls[0][1] as string;
      expect(system).toContain('João Silva');
      expect(system).toContain(PHONE);
      expect(system).toContain('NÃO pergunte novamente');
      expect(system).toContain('JÁ AGENDOU antes');
      expect(system).toContain('Clareamento');
    });

    it('IA indisponível propaga AiUnavailableError (adapter decide o fallback)', async () => {
      conversationsMock.resolveByPhone.mockResolvedValueOnce({
        id: CONVERSATION_ID,
      });
      conversationsMock.getConversation.mockResolvedValueOnce({
        messages: [{ role: 'user', content: 'Oi' }],
      });
      generateMock.mockRejectedValueOnce(
        new AiUnavailableError(new Error('rate limit')),
      );

      await expect(
        service.processInboundMessage({
          clinicId: CLINIC_ID,
          channel: 'whatsapp',
          contactPhone: PHONE,
          message: 'Oi',
        }),
      ).rejects.toBeInstanceOf(AiUnavailableError);
      // user já persistido; assistant não.
      expect(conversationsMock.appendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
