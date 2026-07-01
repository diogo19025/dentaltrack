import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ReminderBlocker,
  ReminderContext,
  SendReminderResult,
} from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { EvolutionService } from '../whatsapp/evolution.service';

/**
 * Normaliza um telefone para o formato que a Evolution espera (dígitos com DDI).
 * Espelha `apps/web/lib/whatsapp.ts`: descarta não-dígitos; 10–11 dígitos
 * (DDD + número, BR sem DDI) recebem o prefixo `55`. Retorna null se for curto
 * demais para ser um número discável.
 */
export function normalizeWhatsappPhone(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.length <= 11 ? `55${digits}` : digits;
}

/** Primeiro nome (para um cumprimento natural), ou null se não houver nome. */
function firstName(name: string | null): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

/**
 * Monta o rascunho determinístico do lembrete a partir do contexto do paciente
 * (sem IA — ver decisão de produto). Texto plano, curto e amistoso, próprio para
 * WhatsApp: cumprimento + clínica + interesse + (oferta vigente) + chamada para
 * agendar. O operador pode editar antes de enviar.
 */
export function buildReminderDraft(input: {
  clinicName: string;
  leadName: string | null;
  interest: string | null;
  offer: string | null;
}): string {
  const name = firstName(input.leadName);
  const greeting = name ? `Olá, ${name}!` : 'Olá!';
  const from = ` Aqui é da ${input.clinicName}.`;
  const interest = input.interest
    ? ` Vimos que você demonstrou interesse em ${input.interest} e seguimos à disposição para te ajudar.`
    : ' Passando para retomar o seu atendimento e tirar qualquer dúvida.';
  const offer = input.offer?.trim() ? ` ${input.offer.trim()}` : '';
  const cta = ' Posso te ajudar a agendar uma avaliação?';
  return `${greeting}${from}${interest}${offer}${cta}`;
}

/**
 * Envio de **lembrete por WhatsApp** disparado pelo CRM (pós-MVP). Reusa o mesmo
 * transporte de saída do canal (`EvolutionService`) e persiste a mensagem na
 * própria conversa (`ConversationsService.appendMessage`) — channel-agnostic, o
 * motor do agente não é tocado. Tudo escopado por `clinicId` (multi-tenant).
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly evolution: EvolutionService,
  ) {}

  /**
   * Contexto da caixa de envio (GET): elegibilidade, telefone resolvido e um
   * rascunho pré-preenchido. Lança 404 se a conversa não for da clínica.
   */
  async getContext(
    clinicId: string,
    conversationId: string,
  ): Promise<ReminderContext> {
    const loaded = await this.load(clinicId, conversationId);
    const { canSend, reason } = this.checkEligibility(
      loaded.normalizedPhone,
      loaded.instance,
    );
    return { canSend, reason, phone: loaded.displayPhone, draft: loaded.draft };
  }

  /**
   * Envia o lembrete e o persiste na conversa (POST). **Envia primeiro**: só
   * grava a mensagem se o WhatsApp aceitou — evita registrar um lembrete que não
   * saiu. Reabre a conversa se estava `abandonada` (transição documentada) para
   * que a resposta do paciente caia no mesmo fio.
   */
  async send(
    clinicId: string,
    conversationId: string,
    message: string,
  ): Promise<SendReminderResult> {
    const loaded = await this.load(clinicId, conversationId);

    if (!loaded.normalizedPhone) {
      throw new BadRequestException(
        'O contato não tem telefone para o envio do lembrete.',
      );
    }
    if (!loaded.instance || !this.evolution.isConfigured()) {
      throw new BadRequestException(
        'O WhatsApp não está configurado para esta clínica.',
      );
    }

    // Contatos migrados p/ LID só recebem no JID `@lid` (enviar p/ o telefone
    // fica preso em PENDING). Resolve on-demand (null p/ contatos não-LID, que
    // caem no telefone, como antes). Ver `EvolutionService.resolveLidJid`.
    const target =
      (await this.evolution.resolveLidJid(
        loaded.instance,
        `${loaded.normalizedPhone}@s.whatsapp.net`,
      )) ?? loaded.normalizedPhone;

    try {
      await this.evolution.sendText(loaded.instance, target, message);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Falha ao enviar lembrete (conversa ${conversationId}): ${detail}`,
      );
      throw new BadGatewayException(
        'Não foi possível enviar o lembrete pelo WhatsApp agora. Tente novamente em instantes.',
      );
    }

    // O lembrete é uma mensagem de saída (role 'assistant'), como a resposta do
    // bot — entra na contagem da conversa e atualiza `lastMessageAt`.
    await this.conversations.appendMessage(
      conversationId,
      'assistant',
      message,
      {},
      clinicId,
    );

    if (loaded.status === 'abandonada') {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'em_andamento' },
      });
    }

    return { conversationId, sentAt: new Date().toISOString() };
  }

  private checkEligibility(
    normalizedPhone: string | null,
    instance: string | null,
  ): { canSend: boolean; reason: ReminderBlocker | null } {
    if (!normalizedPhone) return { canSend: false, reason: 'no_phone' };
    if (!instance || !this.evolution.isConfigured()) {
      return { canSend: false, reason: 'whatsapp_not_configured' };
    }
    return { canSend: true, reason: null };
  }

  /**
   * Carrega tudo o que o lembrete precisa numa conversa escopada por tenant:
   * status, telefone (do canal ou do lead), instância da clínica e o rascunho
   * pronto. Lança 404 (cross-tenant também cai aqui).
   */
  private async load(clinicId: string, conversationId: string) {
    const convo = await this.prisma.conversation.findFirst({
      where: { id: conversationId, clinicId },
      select: {
        id: true,
        status: true,
        contactPhone: true,
        clinic: {
          select: {
            name: true,
            settings: {
              select: {
                whatsappInstance: true,
                offerEnabled: true,
                offerText: true,
              },
            },
          },
        },
        lead: { select: { name: true, phone: true } },
        conversationTags: {
          orderBy: { confidence: 'desc' },
          take: 1,
          select: { tag: { select: { name: true } } },
        },
        appointments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { procedure: { select: { name: true } } },
        },
      },
    });
    if (!convo) {
      throw new NotFoundException(`Conversa ${conversationId} não encontrada.`);
    }

    const settings = convo.clinic.settings;
    const displayPhone = convo.contactPhone ?? convo.lead?.phone ?? null;
    const interest =
      convo.appointments[0]?.procedure?.name ??
      convo.conversationTags[0]?.tag.name ??
      null;
    const offer =
      settings?.offerEnabled && settings.offerText ? settings.offerText : null;

    return {
      status: convo.status,
      displayPhone,
      normalizedPhone: normalizeWhatsappPhone(displayPhone),
      instance: settings?.whatsappInstance ?? null,
      draft: buildReminderDraft({
        clinicName: convo.clinic.name,
        leadName: convo.lead?.name ?? null,
        interest,
        offer,
      }),
    };
  }
}
