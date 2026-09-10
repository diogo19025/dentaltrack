import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { HandoffState } from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * **Handoff humano** (P0.2) — o botão que tira a IA da frente do cliente.
 *
 * Até aqui o produto não tinha nenhum: uma pessoa irritada, um caso delicado ou
 * uma pergunta que o bot não entende continuavam recebendo respostas de robô,
 * porque não havia como um atendente assumir a conversa.
 *
 * **O estado é uma data, não um booleano** (`handoffAt`): `NULL` = a IA
 * responde. Uma data responde de graça a pergunta que a tela faz — "desde
 * quando?" — e um booleano precisaria de uma segunda coluna para isso.
 *
 * **E é ortogonal ao `status`, não um estado novo.** Uma conversa `agendada`
 * (terminal na máquina de estados) também pode precisar de gente, e mexer em
 * `ConversationStatus` quebraria métricas, funil e dashboard, que contam por
 * status. `canTransition` fica intacto.
 *
 * O que este serviço **não** faz, de propósito: fila de atendentes,
 * distribuição, presença, central de suporte. Um atendente assume; quem abrir a
 * conversa vê quem foi e desde quando.
 */
@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Um atendente assume a conversa. **Idempotente:** assumir o que já está
   * assumido devolve o estado como está, sem reiniciar o relógio — a pergunta
   * "há quanto tempo esse cliente está esperando gente?" não pode ser zerada
   * por um duplo clique.
   */
  async assume(
    clinicId: string,
    conversationId: string,
    userId: string | null,
    reason?: string | null,
  ): Promise<HandoffState> {
    const current = await this.require(clinicId, conversationId);
    if (current.handoffAt) {
      this.logger.log({
        event: 'conversation.handoff',
        outcome: 'ok',
        conversationId,
        reaproveitado: true,
      });
      return toState(conversationId, current);
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        handoffAt: new Date(),
        handoffBy: userId,
        handoffReason: reason?.trim() || null,
      },
      select: { handoffAt: true, handoffReason: true },
    });

    this.logger.log({
      event: 'conversation.handoff',
      outcome: 'ok',
      conversationId,
      // O motivo é texto livre escrito por uma pessoa e pode conter dado do
      // cliente — só o fato de haver um é logado.
      comMotivo: Boolean(updated.handoffReason),
    });
    return toState(conversationId, updated);
  }

  /**
   * Devolve a conversa para a IA. **Idempotente:** devolver o que já está com a
   * IA é sucesso, não erro — repetir a operação não pode falhar.
   *
   * O motivo é limpo junto: ele descrevia o atendimento que acabou, e mantê-lo
   * faria a próxima abertura da conversa mostrar a justificativa de um handoff
   * que já não existe.
   */
  async release(
    clinicId: string,
    conversationId: string,
  ): Promise<HandoffState> {
    const current = await this.require(clinicId, conversationId);
    if (!current.handoffAt) return toState(conversationId, current);

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { handoffAt: null, handoffBy: null, handoffReason: null },
    });

    this.logger.log({
      event: 'conversation.handoff',
      outcome: 'ok',
      conversationId,
      devolvido: true,
      // Quanto tempo a conversa ficou com gente — o número que diz se o handoff
      // está sendo usado para resolver ou para esquecer.
      duracaoMs: Date.now() - current.handoffAt.getTime(),
    });
    return toState(conversationId, { handoffAt: null, handoffReason: null });
  }

  /** A conversa existe e é desta empresa? 404 cross-tenant. */
  private async require(clinicId: string, conversationId: string) {
    const convo = await this.prisma.conversation.findFirst({
      where: { id: conversationId, clinicId },
      select: { handoffAt: true, handoffReason: true },
    });
    if (!convo) {
      throw new NotFoundException(`Conversa ${conversationId} não encontrada.`);
    }
    return convo;
  }
}

function toState(
  conversationId: string,
  row: { handoffAt: Date | null; handoffReason: string | null },
): HandoffState {
  return {
    conversationId,
    handoffAt: row.handoffAt?.toISOString() ?? null,
    handoffReason: row.handoffReason,
  };
}
