import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { LeadPrivacy } from '@dentaltrack/shared';
import { OptOutService } from '../automations/opt-out.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Texto que substitui o conteúdo removido. Marcador explícito em vez de string
 * vazia: quem abrir o histórico precisa entender que houve uma mensagem ali e
 * que ela foi removida a pedido — não que a conversa simplesmente falhou.
 */
const REDACTED = '[removido a pedido do titular]';

/** Nome genérico do lead anonimizado, para a tela não ficar com um vazio mudo. */
const ANONYMOUS_NAME = 'Contato anonimizado';

/**
 * **LGPD operacional** (P1.5) — o direito de eliminação, na prática.
 *
 * O desenho central é **anonimizar, não apagar**. A linha do lead sustenta o
 * histórico de atendimento, os agendamentos e a `daily_metric` já fechada;
 * apagá-la destruiria números que não pertencem ao titular e que a empresa tem
 * obrigação de guardar. O que sai é o que identifica a pessoa.
 *
 * Duas decisões que parecem contraditórias e não são:
 *
 * - **`Appointment` é preservado inteiro.** Ele não carrega PII própria (nome e
 *   telefone moram no lead, que está sendo limpo), e apagá-lo levaria junto o
 *   histórico e as métricas.
 * - **`ContactOptOut` é mantido deliberadamente.** Aquele telefone é
 *   justamente o que impede reenviar mensagem para quem pediu para parar.
 *   Apagá-lo em nome da privacidade produziria a violação que ele previne: o
 *   contato voltaria a ser elegível para automação na primeira vez que
 *   aparecesse de novo.
 */
@Injectable()
export class LeadPrivacyService {
  private readonly logger = new Logger(LeadPrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly optOut: OptOutService,
  ) {}

  /**
   * Remove os dados pessoais do lead e de tudo que ele gerou, numa transação.
   *
   * **Idempotente:** anonimizar o que já está anonimizado devolve o estado como
   * está, sem segunda escrita — um duplo clique numa operação destrutiva não
   * pode ter efeito diferente do primeiro.
   *
   * O telefone é lido **antes** de ser apagado: ele é a chave de tudo o que
   * precisa ser limpo na fila de saída e é o que o `ContactOptOut` guarda.
   */
  async anonymize(clinicId: string, leadId: string): Promise<LeadPrivacy> {
    const lead = await this.require(clinicId, leadId);
    if (lead.anonymizedAt) {
      return {
        leadId,
        anonymizedAt: lead.anonymizedAt.toISOString(),
        optedOut: await this.optOut.isOptedOut(clinicId, lead.phone),
      };
    }

    const phone = lead.phone;
    const anonymizedAt = new Date();
    const conversationIds = lead.conversations.map((c) => c.id);

    // Tudo ou nada: um lead sem nome mas com o telefone ainda nas mensagens
    // seria pior do que não ter começado.
    await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id: leadId },
        data: {
          name: ANONYMOUS_NAME,
          phone: null,
          email: null,
          // O id no sistema de gestão também identifica: é por ele que se acha
          // o prontuário da pessoa do outro lado.
          externalId: null,
          anonymizedAt,
        },
      }),
      // A identidade do canal (telefone/JID) é PII e mora na conversa.
      this.prisma.conversation.updateMany({
        where: { clinicId, leadId },
        data: { contactPhone: null },
      }),
      // O conteúdo das mensagens é onde a pessoa contou o que tem — o dado
      // mais sensível do sistema, e o único que nenhuma métrica lê.
      this.prisma.message.updateMany({
        where: { clinicId, conversationId: { in: conversationIds } },
        data: { content: REDACTED },
      }),
      // Mensagens de saída carregam o nome no corpo e o telefone na coluna.
      this.prisma.outboundMessage.updateMany({
        where: { clinicId, leadId },
        data: { body: REDACTED, phone: null },
      }),
    ]);

    // Fora da transação de propósito: a anonimização já está commitada, e um
    // erro aqui não pode desfazê-la. Pior desfecho possível é uma linha órfã
    // na fila, que a revalidação do envio já descarta por falta de telefone.
    if (phone) await this.cancelQueued(clinicId, phone);

    this.logger.log({
      event: 'lead.anonymize',
      outcome: 'ok',
      leadId,
      conversas: conversationIds.length,
    });

    return {
      leadId,
      anonymizedAt: anonymizedAt.toISOString(),
      // O descadastro sobrevive à anonimização — ver o cabeçalho da classe.
      optedOut: await this.optOut.isOptedOut(clinicId, phone),
    };
  }

  /**
   * Liga/desliga o descadastro das mensagens automáticas para o telefone do
   * lead. Idempotente nos dois sentidos (o `OptOutService` faz `upsert` e
   * `deleteMany`).
   *
   * Lead anonimizado não tem telefone para descadastrar — e também não precisa:
   * a fila não tem para onde mandar.
   */
  async setOptOut(
    clinicId: string,
    leadId: string,
    optedOut: boolean,
  ): Promise<LeadPrivacy> {
    const lead = await this.require(clinicId, leadId);

    if (optedOut)
      await this.optOut.optOut(clinicId, lead.phone, 'pedido na tela');
    else await this.optOut.optIn(clinicId, lead.phone);

    this.logger.log({
      event: 'lead.opt_out',
      outcome: 'ok',
      leadId,
      descadastrado: optedOut,
    });

    return {
      leadId,
      anonymizedAt: lead.anonymizedAt?.toISOString() ?? null,
      optedOut: await this.optOut.isOptedOut(clinicId, lead.phone),
    };
  }

  /**
   * Cancela o que ainda não saiu para este telefone. A anonimização não pode
   * deixar uma mensagem pendente com o nome da pessoa no corpo.
   */
  private async cancelQueued(clinicId: string, phone: string): Promise<void> {
    const normalized = OptOutService.normalizePhone(phone);
    if (!normalized) return;
    await this.prisma.outboundMessage.updateMany({
      where: { clinicId, phone: normalized, status: 'pendente' },
      data: { status: 'cancelado', body: REDACTED, phone: null },
    });
  }

  /** O lead existe e é desta empresa? 404 cross-tenant. */
  private async require(clinicId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, clinicId },
      select: {
        id: true,
        phone: true,
        anonymizedAt: true,
        conversations: { select: { id: true } },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    return lead;
  }
}
