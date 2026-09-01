import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Palavras que descadastram o contato. Comparadas contra a mensagem inteira
 * (normalizada), não como substring: "não quero parar o tratamento" não pode
 * descadastrar ninguém.
 */
const OPT_OUT_WORDS = new Set([
  'sair',
  'parar',
  'pare',
  'stop',
  'cancelar',
  'descadastrar',
  'nao quero mais receber',
  'não quero mais receber',
  'remover',
]);

/**
 * Descadastro de mensagens automáticas (F9), persistido por empresa.
 *
 * Até aqui o opt-out era uma resposta amigável guardada em memória (WA-4) — o
 * que bastava num bot **receptivo**, que só falava quando falavam com ele. A
 * partir do momento em que o sistema envia sozinho, isso vira obrigação: quem
 * pediu para parar não pode voltar a receber depois de um restart do processo.
 *
 * O descadastro vale para o **automático**. Se a pessoa escrever de novo, o
 * agente responde normalmente — ela é quem procurou.
 */
@Injectable()
export class OptOutService {
  private readonly logger = new Logger(OptOutService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** A mensagem do cliente é um pedido de descadastro? */
  static isOptOutMessage(text: string | undefined | null): boolean {
    const normalized = text
      ?.trim()
      .toLowerCase()
      .replace(/[!.?]+$/, '');
    if (!normalized) return false;
    return OPT_OUT_WORDS.has(normalized);
  }

  /** Telefone normalizado (só dígitos, com DDI) — mesma forma usada no envio. */
  static normalizePhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return null;
    return digits.length <= 11 ? `55${digits}` : digits;
  }

  async isOptedOut(clinicId: string, phone: string | null): Promise<boolean> {
    const normalized = OptOutService.normalizePhone(phone);
    if (!normalized) return false;
    const row = await this.prisma.contactOptOut.findUnique({
      where: { clinicId_phone: { clinicId, phone: normalized } },
      select: { id: true },
    });
    return row !== null;
  }

  /** Registra o descadastro (idempotente). */
  async optOut(
    clinicId: string,
    phone: string | null,
    reason = 'pedido do contato',
  ): Promise<void> {
    const normalized = OptOutService.normalizePhone(phone);
    if (!normalized) return;
    await this.prisma.contactOptOut.upsert({
      where: { clinicId_phone: { clinicId, phone: normalized } },
      create: { clinicId, phone: normalized, reason },
      update: { reason },
    });
    this.logger.log(
      `Contato descadastrado das automações (empresa ${clinicId}).`,
    );

    // Cancela o que já estava na fila para este contato — continuar enviando o
    // que foi agendado antes do pedido seria ignorá-lo na prática.
    await this.prisma.outboundMessage.updateMany({
      where: { clinicId, phone: normalized, status: 'pendente' },
      data: { status: 'suprimido', reason: 'opt_out' },
    });
  }

  /** Reativa o contato (o dono pode desfazer um descadastro a pedido). */
  async optIn(clinicId: string, phone: string | null): Promise<void> {
    const normalized = OptOutService.normalizePhone(phone);
    if (!normalized) return;
    await this.prisma.contactOptOut.deleteMany({
      where: { clinicId, phone: normalized },
    });
  }
}
