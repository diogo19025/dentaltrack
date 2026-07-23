import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import {
  type Channel,
  type ChatRequest,
  MEDIA_TYPES,
  type MediaAttachment,
  type MediaType,
} from '@dentaltrack/shared';
import {
  AiUnavailableError,
  generateAssistantReply,
  type GenerateReplyResult,
  type ReplyMessage,
  streamAssistantReply,
} from '../ai/generate-reply';
import { buildSystemPrompt, type KnownContact } from '../ai/prompt';
import { detectFunnelStage } from '../ai/stage-detection';
import { tagConversation } from '../ai/tagging';
import { buildChatTools } from '../ai/tools';
import { transcribeAudio } from '../ai/transcribe';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../prisma/prisma.service';

/** Entrada de texto OU áudio (base64) de um turno — comum a web e WhatsApp. */
interface TurnInput {
  message?: string;
  audio?: string;
  audioType?: string;
}

/** Mensagem de entrada de um canal sem login (WhatsApp): identidade = telefone. */
export interface InboundMessage extends TurnInput {
  clinicId: string;
  channel: Channel;
  contactPhone: string;
  /** Nome de perfil do contato no canal (WhatsApp = pushName), se disponível. */
  contactName?: string;
}

/** Resultado de um turno non-streaming (WhatsApp e afins). */
export interface InboundReply {
  conversationId: string;
  reply: string;
  transcript?: string;
  /**
   * Mídia a enviar junto da resposta (F6): saudação (1º contato) e/ou oferta
   * escolhida pela tool `presentOffer`. O adapter do canal envia após o texto.
   */
  attachments: MediaAttachment[];
}

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
   * Streama um turno (BE-1.6) na empresa do usuário autenticado (`clinicId`):
   * abre/continua a conversa, persiste a mensagem do cliente, monta o system
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

    // 1. Persiste a mensagem do cliente (antes do stream → retry mantém contexto).
    await this.conversations.appendMessage(
      conversationId,
      'user',
      userText,
      {},
      clinicId,
    );

    // 2. System prompt (dados da empresa) + histórico (user/assistant) + tools.
    const { systemPrompt, history, tools } = await this.prepareTurn(
      conversationId,
      clinicId,
    );

    // 3. Streama; persiste o texto final do bot (com tokens) no onFinish.
    const stream = streamAssistantReply(history, systemPrompt, tools, {
      onFinish: (result) =>
        this.persistAssistantReply(conversationId, clinicId, result),
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
   * Processa um turno **sem streaming** (BE-1.6 channel-agnostic) para canais sem
   * login identificados por telefone (WhatsApp). Mesmo motor do web — resolve a
   * conversa pelo telefone (não por `conversationId` do cliente), transcreve
   * áudio se houver, monta prompt+histórico+tools e gera a resposta com
   * `generateAssistantReply` (que tem timeout/retry/fallback de provider). A
   * resposta volta como **texto** para o adapter enviar pelo canal; persistência
   * e auto-tagging são idênticos ao web. Lança `AiUnavailableError` se a IA falhar
   * (o adapter decide o que enviar ao cliente).
   */
  async processInboundMessage(input: InboundMessage): Promise<InboundReply> {
    // 0. Texto OU áudio → transcreve antes de tocar o banco (STT pode falhar).
    const { text: userText, transcript } = await this.resolveUserText(input);

    // 1. Identidade pelo telefone: reusa a sessão ativa ou abre nova conversa.
    const { id: conversationId } = await this.conversations.resolveByPhone(
      input.clinicId,
      input.channel,
      input.contactPhone,
    );

    // 1a. Primeiro contato desta conversa? (sem nenhuma mensagem ainda) → manda
    // a mídia de saudação (F6) junto da primeira resposta, se configurada.
    const isFirstTurn =
      (await this.prisma.message.count({ where: { conversationId } })) === 0;
    const greetingMedia = isFirstTurn
      ? await this.loadGreetingMedia(input.clinicId)
      : null;

    // 1b. Captura automática do lead pelo contato do canal: o telefone está
    // sempre disponível e o nome de perfil (pushName) quando houver. Best-effort
    // — não bloqueia a resposta se o banco falhar. Backfill que não sobrescreve
    // dados já capturados (a tool da IA tem prioridade sobre o nome de perfil).
    try {
      await this.conversations.ensureContactLead(
        conversationId,
        input.clinicId,
        {
          phone: input.contactPhone,
          name: input.contactName,
          source: input.channel,
        },
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Falha na captura automática do lead (conversa ${conversationId}): ${detail}`,
      );
    }

    // 2. Persiste a mensagem do cliente antes de gerar (retry mantém contexto).
    await this.conversations.appendMessage(
      conversationId,
      'user',
      userText,
      {},
      input.clinicId,
    );

    // 3. Mesmo preparo do web (prompt + histórico + tools + coletor de mídia).
    const { systemPrompt, history, tools, attachments } =
      await this.prepareTurn(conversationId, input.clinicId);

    // 4. Gera sem streaming (com fallback de provider). Erro → AiUnavailableError.
    // As tools (ex.: `presentOffer`) preenchem `attachments` durante a geração.
    const result = await generateAssistantReply(history, systemPrompt, tools);

    // 5. Persiste a resposta + dispara o auto-tagging (igual ao onFinish do web).
    await this.persistAssistantReply(conversationId, input.clinicId, result);

    // 6. Mídia do turno: saudação (1º contato) primeiro, depois a(s) oferta(s).
    const outbound = greetingMedia
      ? [greetingMedia, ...attachments]
      : attachments;

    return {
      conversationId,
      reply: result.text,
      transcript,
      attachments: outbound,
    };
  }

  /**
   * System prompt da empresa + histórico (user/assistant) + tools da conversa.
   * Compartilhado pelo caminho streaming (web) e non-streaming (WhatsApp).
   * O prompt inclui os dados já conhecidos do cliente (lead vinculado /
   * identidade do canal) — é o que faz o bot reconhecer um contato recorrente
   * sem pedir nome e telefone de novo.
   */
  private async prepareTurn(
    conversationId: string,
    clinicId: string,
  ): Promise<{
    systemPrompt: string;
    history: ReplyMessage[];
    tools: ReturnType<typeof buildChatTools>;
    /** Coletor de mídia da oferta (F6), preenchido pela tool `presentOffer`. */
    attachments: MediaAttachment[];
  }> {
    const [convo, known] = await Promise.all([
      this.conversations.getConversation(conversationId, clinicId),
      this.loadKnownContact(conversationId, clinicId),
    ]);
    const systemPrompt = await this.buildPrompt(clinicId, known?.contact);
    const history: ReplyMessage[] = convo.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as ReplyMessage['role'],
        content: m.content,
      }));
    const attachments: MediaAttachment[] = [];
    const tools = buildChatTools({
      prisma: this.prisma,
      conversations: this.conversations,
      clinicId,
      conversationId,
      channel: known?.channel ?? 'web',
      attachments,
    });
    return { systemPrompt, history, tools, attachments };
  }

  /**
   * Mídia da saudação (F6): enviada no **primeiro** contato de uma conversa por
   * canal (WhatsApp). Best-effort — falha vira "sem mídia". Retorna `null` se a
   * empresa não configurou saudação com mídia.
   */
  private async loadGreetingMedia(
    clinicId: string,
  ): Promise<MediaAttachment | null> {
    try {
      const settings = await this.prisma.clinicSettings.findUnique({
        where: { clinicId },
        select: { greetingMediaUrl: true, greetingMediaType: true },
      });
      const url = settings?.greetingMediaUrl?.trim();
      if (!url) return null;
      const rawType = settings?.greetingMediaType ?? '';
      const type: MediaType = (MEDIA_TYPES as readonly string[]).includes(
        rawType,
      )
        ? (rawType as MediaType)
        : 'image';
      return { url, type };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Falha ao carregar mídia de saudação (empresa ${clinicId}): ${detail}`,
      );
      return null;
    }
  }

  /**
   * Carrega o que já se sabe do cliente da conversa: lead vinculado (nome,
   * telefone, e-mail), identidade do canal (`contactPhone` no WhatsApp) e os
   * últimos agendamentos do lead (sinal de recorrência). Best-effort — qualquer
   * falha vira "nenhum dado conhecido" e o turno segue normal.
   */
  private async loadKnownContact(
    conversationId: string,
    clinicId: string,
  ): Promise<{ channel: Channel; contact: KnownContact | null } | null> {
    try {
      const convo = await this.prisma.conversation.findFirst({
        where: { id: conversationId, clinicId },
        select: {
          channel: true,
          contactPhone: true,
          lead: {
            select: { id: true, name: true, phone: true, email: true },
          },
        },
      });
      if (!convo) return null;

      const phone = convo.lead?.phone ?? convo.contactPhone ?? null;
      if (!convo.lead && !phone)
        return { channel: convo.channel, contact: null };

      const appointments = convo.lead
        ? await this.prisma.appointment.findMany({
            where: { clinicId, leadId: convo.lead.id },
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: {
              createdAt: true,
              preferredTime: true,
              procedure: { select: { name: true } },
            },
          })
        : [];

      return {
        channel: convo.channel,
        contact: {
          name: convo.lead?.name ?? null,
          phone,
          email: convo.lead?.email ?? null,
          appointments: appointments.map((a) => ({
            procedureName: a.procedure?.name ?? null,
            preferredTime: a.preferredTime,
            createdAt: a.createdAt,
          })),
        },
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Falha ao carregar contato conhecido (conversa ${conversationId}): ${detail}`,
      );
      return null;
    }
  }

  /**
   * Persiste a resposta final do bot (com tokens) e dispara o auto-tagging
   * (BE-3.1, best-effort). Compartilhado pelo `onFinish` do stream (web) e pelo
   * fluxo non-streaming (WhatsApp). Falhas são logadas, não propagadas.
   */
  private async persistAssistantReply(
    conversationId: string,
    clinicId: string,
    { text, tokens }: GenerateReplyResult,
  ): Promise<void> {
    if (!text) return;
    try {
      await this.conversations.appendMessage(
        conversationId,
        'assistant',
        text,
        { tokens },
        clinicId,
      );
      // Auto-tagging (BE-3.1) — best-effort, após a resposta persistida (o
      // classificador lê o histórico do banco).
      void tagConversation({
        prisma: this.prisma,
        clinicId,
        conversationId,
      });
      // Detecção de estágio do funil (F7) — best-effort, mesmo padrão.
      void detectFunnelStage({
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
  }

  /**
   * Resolve o texto do turno do cliente. Texto → passa direto; áudio (base64)
   * → transcreve via `ai/transcribe` (speech-to-text) e usa a transcrição como
   * mensagem — o restante do fluxo (histórico, tools, tagging) é idêntico, e o
   * canal (web hoje, WhatsApp depois) não precisa conhecer o STT.
   */
  private async resolveUserText(
    input: TurnInput,
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
   * Monta o system prompt da empresa (BE-1.3): identidade + settings (opcional)
   * + catálogo de procedimentos ativos. Tudo escopado por `clinicId`.
   */
  private async buildPrompt(
    clinicId: string,
    contact?: KnownContact | null,
  ): Promise<string> {
    const [clinic, settings, procedures] = await Promise.all([
      this.prisma.clinic.findUnique({ where: { id: clinicId } }),
      this.prisma.clinicSettings.findUnique({ where: { clinicId } }),
      this.prisma.procedure.findMany({
        where: { clinicId, active: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    if (!clinic)
      throw new NotFoundException(`Empresa ${clinicId} não encontrada.`);
    return buildSystemPrompt({ clinic, settings, procedures, contact });
  }

  /**
   * Resolve a conversa do turno, sempre escopada na empresa do tenant:
   * - com `conversationId`: valida que pertence à empresa (404 se não);
   * - sem ele: abre uma nova conversa na empresa.
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
