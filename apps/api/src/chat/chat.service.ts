import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { ChatRequest } from '@dentaltrack/shared';
import {
  AiUnavailableError,
  type ReplyMessage,
  streamAssistantReply,
} from '../ai/generate-reply';
import { buildSystemPrompt } from '../ai/prompt';
import { tagConversation } from '../ai/tagging';
import { buildChatTools } from '../ai/tools';
import { transcribeAudio } from '../ai/transcribe';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Orquestra um turno de conversa com **streaming** (BE-1.6). Channel-agnostic:
 * o motor não conhece o canal. Tudo escopado pelo `clinicId` do tenant
 * autenticado (resolvido pelo TenantGuard a partir do JWT).
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Streama um turno (BE-1.6) na clínica do usuário autenticado (`clinicId`):
   * abre/continua a conversa, persiste a mensagem do paciente, monta o system
   * prompt + histórico + tools e pipa a resposta do AI SDK como UI message
   * stream (consumível pelo `useChat`). A resposta do bot é persistida no
   * `onFinish`; o `conversationId` volta no header `X-Conversation-Id`. As tools
   * (lead/agendamento) rodam durante o stream e disparam a transição p/ `agendada`.
   */
  async streamMessage(
    input: ChatRequest,
    clinicId: string,
    res: ServerResponse,
  ): Promise<void> {
    // 0. Entrada por áudio? Transcreve ANTES de tocar o banco (falha de STT não
    // deixa conversa vazia nem mensagem persistida) — erros viram HTTP pré-stream.
    const { text: userText, transcript } = await this.resolveUserText(input);

    const conversationId = await this.resolveConversation(input, clinicId);

    // 1. Persiste a mensagem do paciente (antes do stream → retry mantém contexto).
    await this.conversations.appendMessage(
      conversationId,
      'user',
      userText,
      {},
      clinicId,
    );

    // 2. System prompt (dados da clínica) + histórico (user/assistant) + tools.
    const systemPrompt = await this.buildPrompt(clinicId);
    const convo = await this.conversations.getConversation(
      conversationId,
      clinicId,
    );
    const history: ReplyMessage[] = convo.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as ReplyMessage['role'],
        content: m.content,
      }));

    const tools = buildChatTools({
      prisma: this.prisma,
      conversations: this.conversations,
      clinicId,
      conversationId,
    });

    // 3. Streama; persiste o texto final do bot (com tokens) no onFinish.
    const stream = streamAssistantReply(history, systemPrompt, tools, {
      onFinish: async ({ text, tokens }) => {
        if (!text) return;
        try {
          await this.conversations.appendMessage(
            conversationId,
            'assistant',
            text,
            { tokens },
            clinicId,
          );
          // Auto-tagging (BE-3.1) — best-effort, fora do caminho do stream e
          // após a resposta persistida (o classificador lê o histórico do banco).
          void tagConversation({
            prisma: this.prisma,
            clinicId,
            conversationId,
          });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Falha ao persistir resposta (conversa ${conversationId}): ${detail}`,
          );
        }
      },
      onError: (err) => {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `IA (stream) indisponível (conversa ${conversationId}): ${detail}`,
        );
      },
    });

    // 4. Pipa como UI message stream; devolve o conversationId (e, no turno por
    // áudio, a transcrição — URI-encoded, headers são ISO-8859-1) nos headers.
    stream.pipeUIMessageStreamToResponse(res, {
      headers: {
        'X-Conversation-Id': conversationId,
        ...(transcript
          ? { 'X-Transcript': encodeURIComponent(transcript) }
          : {}),
      },
      onError: () =>
        'O assistente está temporariamente indisponível. Sua mensagem foi salva — tente novamente em instantes.',
    });
  }

  /**
   * Resolve o texto do turno do paciente. Texto → passa direto; áudio (base64)
   * → transcreve via `ai/transcribe` (speech-to-text) e usa a transcrição como
   * mensagem — o restante do fluxo (histórico, tools, tagging) é idêntico, e o
   * canal (web hoje, WhatsApp depois) não precisa conhecer o STT.
   */
  private async resolveUserText(
    input: ChatRequest,
  ): Promise<{ text: string; transcript?: string }> {
    if (!input.audio) {
      // O schema (XOR message/audio) garante `message` aqui.
      return { text: input.message ?? '' };
    }

    // Normaliza "audio/webm;codecs=opus" → "audio/webm".
    const mediaType = (input.audioType ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const audio = Buffer.from(input.audio, 'base64');

    try {
      const transcript = await transcribeAudio(audio, mediaType);
      if (!transcript) {
        throw new UnprocessableEntityException(
          'Não foi possível entender o áudio. Tente gravar novamente.',
        );
      }
      return { text: transcript, transcript };
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        throw new ServiceUnavailableException(
          'A transcrição do áudio está temporariamente indisponível. Tente novamente em instantes.',
        );
      }
      throw err;
    }
  }

  /**
   * Monta o system prompt da clínica (BE-1.3): identidade + settings (opcional)
   * + catálogo de procedimentos ativos. Tudo escopado por `clinicId`.
   */
  private async buildPrompt(clinicId: string): Promise<string> {
    const [clinic, settings, procedures] = await Promise.all([
      this.prisma.clinic.findUnique({ where: { id: clinicId } }),
      this.prisma.clinicSettings.findUnique({ where: { clinicId } }),
      this.prisma.procedure.findMany({
        where: { clinicId, active: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    if (!clinic)
      throw new NotFoundException(`Clínica ${clinicId} não encontrada.`);
    return buildSystemPrompt({ clinic, settings, procedures });
  }

  /**
   * Resolve a conversa do turno, sempre escopada na clínica do tenant:
   * - com `conversationId`: valida que pertence à clínica (404 se não);
   * - sem ele: abre uma nova conversa na clínica.
   */
  private async resolveConversation(
    input: ChatRequest,
    clinicId: string,
  ): Promise<string> {
    if (input.conversationId) {
      const convo = await this.prisma.conversation.findFirst({
        where: { id: input.conversationId, clinicId },
        select: { id: true },
      });
      if (!convo) {
        throw new NotFoundException(
          `Conversa ${input.conversationId} não encontrada.`,
        );
      }
      return convo.id;
    }

    const convo = await this.conversations.createConversation(clinicId);
    return convo.id;
  }
}
