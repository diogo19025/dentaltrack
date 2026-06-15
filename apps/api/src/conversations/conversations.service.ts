import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Channel,
  ConversationDetail,
  ConversationStatus,
  ConversationSummary,
  MessageRole,
} from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { canTransition } from './conversation-status';

/** Opções ao abrir uma conversa (lead e canal são opcionais; canal default = web). */
export interface CreateConversationInput {
  leadId?: string;
  channel?: Channel;
  /** Identidade do contato em canais sem login (WhatsApp = telefone/JID). */
  contactPhone?: string;
}

/**
 * Janela (horas) em que uma conversa de WhatsApp ainda em andamento é reusada
 * para o mesmo contato. Fora dela (ou se a última já foi agendada/abandonada),
 * abre-se uma nova conversa. Default 24h.
 */
const SESSION_WINDOW_HOURS = Number(process.env.WHATSAPP_SESSION_HOURS ?? 24);

/**
 * Quantas mensagens o detalhe da conversa retorna (as mais recentes). 20 ≈ 10
 * idas e voltas paciente×bot — o suficiente para o painel "ver mais" do dashboard.
 */
const DETAIL_THREAD_LIMIT = 20;

/** Opções ao anexar uma mensagem (ex.: contagem de tokens do provedor de IA). */
export interface AppendMessageInput {
  tokens?: number;
}

/**
 * Serviço de conversas (BE-1.2). Channel-agnostic — não conhece o canal.
 * Multi-tenant: toda operação é escopada por `clinicId` (derivado da conversa
 * quando não é informado), conforme docs/plan.md §2 e docs/context.md §6.
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Abre uma conversa para a clínica (status inicial = em_andamento). */
  createConversation(clinicId: string, input: CreateConversationInput = {}) {
    return this.prisma.conversation.create({
      data: {
        clinicId,
        leadId: input.leadId,
        channel: input.channel ?? 'web',
        contactPhone: input.contactPhone ?? null,
        status: 'em_andamento',
      },
    });
  }

  /**
   * Resolve a conversa de um contato sem login (WhatsApp): a identidade é o
   * **telefone/JID**, não um `conversationId` vindo do cliente. Reusa a conversa
   * `em_andamento` mais recente do contato dentro da janela de sessão; fora dela
   * (ou se a última já foi `agendada`/`abandonada`) abre uma nova. Escopado por
   * `clinicId` + `channel`. Mantém o motor channel-agnostic — só o adapter chama.
   */
  async resolveByPhone(
    clinicId: string,
    channel: Channel,
    contactPhone: string,
    sessionWindowHours = SESSION_WINDOW_HOURS,
  ): Promise<{ id: string }> {
    const since = new Date(Date.now() - sessionWindowHours * 3_600_000);
    const existing = await this.prisma.conversation.findFirst({
      where: {
        clinicId,
        channel,
        contactPhone,
        status: 'em_andamento',
        lastMessageAt: { gte: since },
      },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });
    if (existing) return existing;

    const created = await this.createConversation(clinicId, {
      channel,
      contactPhone,
    });
    return { id: created.id };
  }

  /**
   * Anexa uma mensagem à conversa e atualiza `lastMessageAt` atomicamente.
   * O `clinicId` é derivado da conversa (denormalizado na mensagem) — se
   * `clinicId` for informado, valida que a conversa pertence ao tenant.
   */
  async appendMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    input: AppendMessageInput = {},
    clinicId?: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, ...(clinicId ? { clinicId } : {}) },
      select: { id: true, clinicId: true },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversa ${conversationId} não encontrada.`);
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          clinicId: conversation.clinicId,
          role,
          content,
          tokens: input.tokens,
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return message;
  }

  /**
   * Busca a conversa com suas mensagens (em ordem cronológica).
   * Quando `clinicId` é informado, escopa por tenant. Lança 404 se não existir.
   */
  async getConversation(conversationId: string, clinicId?: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, ...(clinicId ? { clinicId } : {}) },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversa ${conversationId} não encontrada.`);
    }
    return conversation;
  }

  /**
   * Conversas recentes da clínica (F3 · tabela do dashboard). Mais recente
   * primeiro (por `lastMessageAt`, depois `createdAt`). Inclui lead, tags
   * detectadas e o procedimento do último agendamento.
   */
  async listRecent(
    clinicId: string,
    limit = 8,
  ): Promise<ConversationSummary[]> {
    const convos = await this.prisma.conversation.findMany({
      where: { clinicId },
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take: limit,
      select: {
        id: true,
        status: true,
        lastMessageAt: true,
        lead: { select: { name: true } },
        conversationTags: {
          orderBy: { confidence: 'desc' },
          select: { tag: { select: { name: true, color: true } } },
        },
        appointments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { procedure: { select: { name: true } } },
        },
      },
    });

    return convos.map((c) => ({
      id: c.id,
      leadName: c.lead?.name ?? null,
      procedure: c.appointments[0]?.procedure?.name ?? null,
      tags: c.conversationTags.map((ct) => ({
        name: ct.tag.name,
        color: ct.tag.color,
      })),
      status: c.status,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    }));
  }

  /**
   * Detalhe da conversa (F3 · rail de tags do chat). Escopado por `clinicId`.
   * Retorna status, contagem de mensagens e as tags detectadas (com confiança).
   */
  async getDetail(
    conversationId: string,
    clinicId: string,
  ): Promise<ConversationDetail> {
    const convo = await this.prisma.conversation.findFirst({
      where: { id: conversationId, clinicId },
      select: {
        id: true,
        status: true,
        channel: true,
        createdAt: true,
        contactPhone: true,
        lead: { select: { phone: true } },
        _count: { select: { messages: true } },
        conversationTags: {
          orderBy: { confidence: 'desc' },
          select: {
            confidence: true,
            tag: { select: { id: true, name: true, color: true } },
          },
        },
        // Últimas N mensagens (paciente × bot) — buscadas em ordem decrescente e
        // revertidas abaixo para exibição cronológica. ~10 idas e voltas.
        messages: {
          where: { role: { not: 'system' } },
          orderBy: { createdAt: 'desc' },
          take: DETAIL_THREAD_LIMIT,
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    });
    if (!convo) {
      throw new NotFoundException(`Conversa ${conversationId} não encontrada.`);
    }
    return {
      id: convo.id,
      status: convo.status,
      channel: convo.channel,
      createdAt: convo.createdAt.toISOString(),
      messageCount: convo._count.messages,
      contactPhone: convo.contactPhone ?? convo.lead?.phone ?? null,
      tags: convo.conversationTags.map((ct) => ({
        id: ct.tag.id,
        name: ct.tag.name,
        color: ct.tag.color,
        confidence: ct.confidence,
      })),
      messages: convo.messages
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        }))
        .reverse(),
    };
  }

  /** Marca a conversa como `agendada` (conversão). Ver BE-1.7. */
  markAsScheduled(conversationId: string, clinicId?: string) {
    return this.transition(conversationId, 'agendada', clinicId);
  }

  /** Marca a conversa como `abandonada` (inatividade). Sem cron ainda (BE-1.7). */
  markAsAbandoned(conversationId: string, clinicId?: string) {
    return this.transition(conversationId, 'abandonada', clinicId);
  }

  /**
   * Aplica uma transição de status validada (escopada por `clinicId`).
   * Mesmo estado = no-op (retorna a conversa). Transição inválida → 400.
   */
  private async transition(
    conversationId: string,
    to: ConversationStatus,
    clinicId?: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, ...(clinicId ? { clinicId } : {}) },
      select: { id: true, status: true },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversa ${conversationId} não encontrada.`);
    }
    if (conversation.status === to) {
      return this.prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
    }
    if (!canTransition(conversation.status, to)) {
      throw new BadRequestException(
        `Transição de status inválida: ${conversation.status} → ${to}.`,
      );
    }
    return this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: to },
    });
  }
}
