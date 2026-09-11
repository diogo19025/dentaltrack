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
 * - **`Appointment` é preservado como linha**, mas não inteiro. Ele sustenta o
 *   histórico e a `daily_metric`, então apagá-lo está fora de questão; só que
 *   o `preferredTime` é **texto livre digitado pelo cliente** ("terça de manhã,
 *   é para o meu filho João"), extraído pelo modelo, e ainda por cima volta
 *   para o system prompt em `ai/prompt.ts`. Ele é limpo; o resto da linha fica.
 *   O `notes` não entra na limpeza porque guarda o nome do procedimento, não
 *   palavra de paciente.
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

    // **Pelo telefone também, não só pelo vínculo.** O `leadId` da conversa é
    // preenchido quando o lead é capturado; tudo o que o contato escreveu antes
    // disso — ou numa conversa cujo vínculo falhou, ou que ficou órfã porque o
    // lead anterior foi removido (`onDelete: SetNull`) — fica numa conversa com
    // o telefone dele e `leadId` nulo. Buscar só por `leadId` deixava ali a
    // identidade do canal **e o conteúdo das mensagens**, que é o dado mais
    // sensível do sistema.
    const conversationIds = await this.conversationsOf(clinicId, leadId, phone);
    const phones = phoneVariants(phone);

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
        where: { clinicId, id: { in: conversationIds } },
        data: { contactPhone: null },
      }),
      // O conteúdo das mensagens é onde a pessoa contou o que tem — o dado
      // mais sensível do sistema, e o único que nenhuma métrica lê.
      this.prisma.message.updateMany({
        where: { clinicId, conversationId: { in: conversationIds } },
        data: { content: REDACTED },
      }),
      // Preferência de horário: palavra do cliente, e ela reaparece no prompt
      // do agente enquanto estiver lá. A linha do agendamento fica.
      this.prisma.appointment.updateMany({
        where: {
          clinicId,
          preferredTime: { not: null },
          OR: [{ leadId }, { conversationId: { in: conversationIds } }],
        },
        data: { preferredTime: null },
      }),
      // Mensagens de saída carregam o nome no corpo e o telefone na coluna —
      // e, como as conversas, nem sempre têm o `leadId` preenchido.
      this.prisma.outboundMessage.updateMany({
        where: {
          clinicId,
          OR: [
            { leadId },
            ...(phones.length ? [{ phone: { in: phones } }] : []),
          ],
        },
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

  /**
   * Conversas do titular: as vinculadas ao lead **mais** as que carregam o
   * telefone dele sem vínculo. Ver o comentário no `anonymize`.
   */
  private async conversationsOf(
    clinicId: string,
    leadId: string,
    phone: string | null,
  ): Promise<string[]> {
    const phones = phoneVariants(phone);
    const rows = await this.prisma.conversation.findMany({
      where: {
        clinicId,
        OR: [
          { leadId },
          ...(phones.length ? [{ contactPhone: { in: phones } }] : []),
        ],
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** O lead existe e é desta empresa? 404 cross-tenant. */
  private async require(clinicId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, clinicId },
      select: { id: true, phone: true, anonymizedAt: true },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    return lead;
  }
}

/**
 * As formas em que aquele telefone pode estar gravado.
 *
 * Não há uma só: a `Conversation.contactPhone` guarda o número como o canal
 * entregou, a `OutboundMessage.phone` guarda o normalizado, e o `Lead.phone`
 * pode ter vindo de uma importação com máscara. Comparar por uma forma só
 * deixaria dado para trás, e numa operação de LGPD isso não é aceitável.
 */
function phoneVariants(phone: string | null): string[] {
  const normalized = OptOutService.normalizePhone(phone);
  return [
    ...new Set([phone, normalized].filter((v): v is string => Boolean(v))),
  ];
}
