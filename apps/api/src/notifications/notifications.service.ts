import { Injectable } from '@nestjs/common';
import {
  AUTOMATION_LABELS,
  type NotificationItem,
  type NotificationsDto,
  type NotificationsSeenResult,
} from '@dentaltrack/shared';
import {
  DEFAULT_TIMEZONE,
  formatDatePtBr,
  formatTimePtBr,
} from '../common/time';
import { PrismaService } from '../prisma/prisma.service';

/** Janela do painel — mais velho que isso não é "notificação", é histórico. */
const WINDOW_DAYS = 7;
/** Teto de itens no painel (e por query — o merge nunca corta um tipo inteiro). */
const MAX_ITEMS = 30;

/** Item ainda sem o `unread` — o marco do "visto" só é aplicado no final. */
type DraftItem = Omit<NotificationItem, 'unread'>;

/**
 * Central de notificações (F11) — derivada das tabelas que o produto já grava.
 *
 * Cinco fontes, cinco queries, um merge por data: conversas novas, leads
 * capturados, agendamentos, conversas abandonadas (cron) e automações que
 * falharam. Nenhum evento é gravado — se a regra de um tipo mudar, o painel
 * inteiro muda retroativamente, que é o comportamento certo para um resumo.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getNotifications(clinicId: string): Promise<NotificationsDto> {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [settings, conversations, abandoned, leads, appointments, failed] =
      await Promise.all([
        this.prisma.clinicSettings.findUnique({
          where: { clinicId },
          select: { notificationsSeenAt: true },
        }),
        this.prisma.conversation.findMany({
          where: { clinicId, createdAt: { gte: since } },
          select: {
            id: true,
            channel: true,
            contactPhone: true,
            createdAt: true,
            lead: { select: { name: true, phone: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_ITEMS,
        }),
        this.prisma.conversation.findMany({
          where: { clinicId, status: 'abandonada', updatedAt: { gte: since } },
          select: {
            id: true,
            channel: true,
            contactPhone: true,
            updatedAt: true,
            lead: { select: { name: true, phone: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: MAX_ITEMS,
        }),
        this.prisma.lead.findMany({
          // Importação em massa (F8) geraria dezenas de itens de uma vez e
          // afogaria o sino — a tela de Leads já mostra o resultado do import.
          where: {
            clinicId,
            createdAt: { gte: since },
            NOT: { source: 'import' },
          },
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_ITEMS,
        }),
        this.prisma.appointment.findMany({
          where: { clinicId, createdAt: { gte: since } },
          select: {
            id: true,
            startsAt: true,
            preferredTime: true,
            createdAt: true,
            lead: { select: { name: true, phone: true } },
            conversation: { select: { contactPhone: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_ITEMS,
        }),
        this.prisma.outboundMessage.findMany({
          where: { clinicId, status: 'falhou', updatedAt: { gte: since } },
          select: {
            id: true,
            kind: true,
            phone: true,
            updatedAt: true,
            lead: { select: { name: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: MAX_ITEMS,
        }),
      ]);

    const drafts: DraftItem[] = [
      ...conversations.map((c): DraftItem => {
        const channel = c.channel === 'whatsapp' ? 'whatsapp' : 'web';
        return {
          id: `conversa_iniciada:${c.id}`,
          type: 'conversa_iniciada',
          title:
            channel === 'whatsapp'
              ? 'Nova conversa pelo WhatsApp'
              : 'Nova conversa pelo site',
          description: contactLabel(
            c.lead?.name,
            c.lead?.phone ?? c.contactPhone,
          ),
          occurredAt: c.createdAt.toISOString(),
          channel,
        };
      }),
      ...abandoned.map((c): DraftItem => {
        const channel = c.channel === 'whatsapp' ? 'whatsapp' : 'web';
        return {
          id: `conversa_abandonada:${c.id}`,
          type: 'conversa_abandonada',
          title: 'Conversa abandonada',
          description: contactLabel(
            c.lead?.name,
            c.lead?.phone ?? c.contactPhone,
          ),
          occurredAt: c.updatedAt.toISOString(),
          channel,
        };
      }),
      ...leads.map(
        (l): DraftItem => ({
          id: `lead_capturado:${l.id}`,
          type: 'lead_capturado',
          title: 'Novo lead capturado',
          description: contactLabel(l.name, l.phone ?? l.email),
          occurredAt: l.createdAt.toISOString(),
          channel: null,
        }),
      ),
      ...appointments.map((a): DraftItem => {
        const contact = contactLabel(
          a.lead?.name,
          a.lead?.phone ?? a.conversation?.contactPhone,
        );
        const when = a.startsAt
          ? `${formatDatePtBr(a.startsAt, DEFAULT_TIMEZONE)} às ${formatTimePtBr(a.startsAt, DEFAULT_TIMEZONE)}`
          : a.preferredTime;
        return {
          id: `agendamento_criado:${a.id}`,
          type: 'agendamento_criado',
          title: 'Novo agendamento',
          description: [contact, when].filter(Boolean).join(' · ') || null,
          occurredAt: a.createdAt.toISOString(),
          channel: null,
        };
      }),
      ...failed.map(
        (m): DraftItem => ({
          id: `automacao_falhou:${m.id}`,
          type: 'automacao_falhou',
          title: 'Mensagem automática falhou',
          description:
            [AUTOMATION_LABELS[m.kind], contactLabel(m.lead?.name, m.phone)]
              .filter(Boolean)
              .join(' · ') || null,
          occurredAt: m.updatedAt.toISOString(),
          channel: null,
        }),
      ),
    ];

    drafts.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    const seenAt = settings?.notificationsSeenAt ?? null;
    const seenIso = seenAt?.toISOString() ?? null;
    const items = drafts.slice(0, MAX_ITEMS).map(
      (d): NotificationItem => ({
        ...d,
        unread: seenIso === null || d.occurredAt > seenIso,
      }),
    );

    return {
      items,
      unreadCount: items.filter((i) => i.unread).length,
      seenAt: seenIso,
    };
  }

  /**
   * Marca tudo como visto. Upsert porque a linha de settings nasce no primeiro
   * salvamento da tela de Configurações — o sino pode ser aberto antes disso.
   */
  async markSeen(clinicId: string): Promise<NotificationsSeenResult> {
    const now = new Date();
    await this.prisma.clinicSettings.upsert({
      where: { clinicId },
      update: { notificationsSeenAt: now },
      create: { clinicId, notificationsSeenAt: now },
    });
    return { seenAt: now.toISOString() };
  }
}

/** Nome do contato, senão telefone/e-mail, senão null (a UI omite a linha). */
function contactLabel(
  name: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  return name?.trim() || fallback?.trim() || null;
}
