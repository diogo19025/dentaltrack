import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ChatRequest, ChatResponse } from "@dentaltrack/shared";
import { AiUnavailableError, type ReplyMessage, generateAssistantReply } from "../ai/generate-reply";
import { buildSystemPrompt } from "../ai/prompt";
import { buildChatTools } from "../ai/tools";
import { ConversationsService } from "../conversations/conversations.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Orquestra um turno de conversa (BE-1.6 — IA real, sem streaming/tools).
 * Fluxo: resolve/abre conversa → grava msg do usuário → chama a IA com o
 * histórico → grava a resposta → retorna. Tudo escopado por `clinicId`.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly prisma: PrismaService,
  ) {}

  async handleMessage(input: ChatRequest): Promise<ChatResponse> {
    const { conversationId, clinicId } = await this.resolveConversation(input);

    // 1. Persiste a mensagem do paciente.
    await this.conversations.appendMessage(conversationId, "user", input.message, {}, clinicId);

    // 2. Monta o system prompt (dados da clínica) + histórico e chama a IA.
    const systemPrompt = await this.buildPrompt(clinicId);
    const convo = await this.conversations.getConversation(conversationId, clinicId);
    const history: ReplyMessage[] = convo.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as ReplyMessage["role"], content: m.content }));

    // Tools com contexto da conversa (capturam lead, agendam — escopadas no clinicId).
    const tools = buildChatTools({
      prisma: this.prisma,
      conversations: this.conversations,
      clinicId,
      conversationId,
    });
    const reply = await this.generateReply(history, systemPrompt, conversationId, tools);

    // 3. Persiste a resposta do bot (com tokens usados).
    const assistant = await this.conversations.appendMessage(
      conversationId,
      "assistant",
      reply.text,
      { tokens: reply.tokens },
      clinicId,
    );

    return {
      conversationId,
      assistantMessage: {
        id: assistant.id,
        role: "assistant",
        content: assistant.content,
        createdAt: assistant.createdAt.toISOString(),
      },
    };
  }

  /**
   * Chama a IA tratando falhas do provider (chave/rate limit/timeout):
   * loga o erro real e devolve um 503 amigável — sem derrubar o backend.
   * A mensagem do usuário já foi persistida, então o retry mantém o contexto.
   */
  private async generateReply(
    history: ReplyMessage[],
    systemPrompt: string,
    conversationId: string,
    tools?: ReturnType<typeof buildChatTools>,
  ) {
    try {
      return await generateAssistantReply(history, systemPrompt, tools);
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        const detail = err.cause instanceof Error ? err.cause.message : String(err.cause);
        this.logger.error(`IA indisponível (conversa ${conversationId}): ${detail}`);
        throw new ServiceUnavailableException({
          statusCode: 503,
          error: "AI_UNAVAILABLE",
          message:
            "O assistente está temporariamente indisponível. Sua mensagem foi salva — tente novamente em instantes.",
        });
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
        orderBy: { name: "asc" },
      }),
    ]);
    if (!clinic) throw new NotFoundException(`Clínica ${clinicId} não encontrada.`);
    return buildSystemPrompt({ clinic, settings, procedures });
  }

  /**
   * Garante uma conversa e seu `clinicId`:
   * - com `conversationId`: deriva o clinicId da própria conversa;
   * - sem ele: abre uma nova conversa na clínica resolvida (body ou 1ª/demo).
   */
  private async resolveConversation(
    input: ChatRequest,
  ): Promise<{ conversationId: string; clinicId: string }> {
    if (input.conversationId) {
      const convo = await this.prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { id: true, clinicId: true },
      });
      if (!convo) {
        throw new NotFoundException(`Conversa ${input.conversationId} não encontrada.`);
      }
      if (input.clinicId && input.clinicId !== convo.clinicId) {
        throw new BadRequestException("conversationId não pertence à clínica informada.");
      }
      return { conversationId: convo.id, clinicId: convo.clinicId };
    }

    const clinicId = await this.resolveClinicId(input.clinicId);
    const convo = await this.conversations.createConversation(clinicId);
    return { conversationId: convo.id, clinicId };
  }

  /** clinicId do body (validado) ou a 1ª clínica (a demo do seed). */
  private async resolveClinicId(clinicId?: string): Promise<string> {
    if (clinicId) {
      const exists = await this.prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException(`Clínica ${clinicId} não encontrada.`);
      return clinicId;
    }

    const first = await this.prisma.clinic.findFirst({ orderBy: { createdAt: "asc" } });
    if (!first) {
      throw new BadRequestException("Nenhuma clínica cadastrada. Rode o seed (pnpm db:seed).");
    }
    return first.id;
  }
}
