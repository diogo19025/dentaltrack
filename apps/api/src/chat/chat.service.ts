import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import type { ChatRequest } from "@dentaltrack/shared";
import { type ReplyMessage, streamAssistantReply } from "../ai/generate-reply";
import { buildSystemPrompt } from "../ai/prompt";
import { buildChatTools } from "../ai/tools";
import { ConversationsService } from "../conversations/conversations.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Orquestra um turno de conversa com **streaming** (BE-1.6). Channel-agnostic:
 * o motor não conhece o canal. Tudo escopado por `clinicId`.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Streama um turno (BE-1.6): abre/continua a conversa, persiste a mensagem do
   * paciente, monta o system prompt + histórico + tools e pipa a resposta do AI
   * SDK como UI message stream (consumível pelo `useChat`). A resposta do bot é
   * persistida no `onFinish`; o `conversationId` volta no header
   * `X-Conversation-Id`. As tools (lead/agendamento) rodam durante o stream e
   * disparam a transição para `agendada`.
   */
  async streamMessage(input: ChatRequest, res: ServerResponse): Promise<void> {
    const { conversationId, clinicId } = await this.resolveConversation(input);

    // 1. Persiste a mensagem do paciente (antes do stream → retry mantém contexto).
    await this.conversations.appendMessage(conversationId, "user", input.message, {}, clinicId);

    // 2. System prompt (dados da clínica) + histórico (user/assistant) + tools.
    const systemPrompt = await this.buildPrompt(clinicId);
    const convo = await this.conversations.getConversation(conversationId, clinicId);
    const history: ReplyMessage[] = convo.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as ReplyMessage["role"], content: m.content }));

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
            "assistant",
            text,
            { tokens },
            clinicId,
          );
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          this.logger.error(`Falha ao persistir resposta (conversa ${conversationId}): ${detail}`);
        }
      },
      onError: (err) => {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.error(`IA (stream) indisponível (conversa ${conversationId}): ${detail}`);
      },
    });

    // 4. Pipa como UI message stream; devolve o conversationId no header.
    stream.pipeUIMessageStreamToResponse(res, {
      headers: { "X-Conversation-Id": conversationId },
      onError: () =>
        "O assistente está temporariamente indisponível. Sua mensagem foi salva — tente novamente em instantes.",
    });
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
