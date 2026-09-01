import { Injectable, Logger } from '@nestjs/common';
import {
  type AutomationSettings,
  REMINDER_LEAD_MINUTES,
  renderTemplate,
} from '@dentaltrack/shared';
import { formatDatePtBr, formatTimePtBr } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationSettingsService } from './automation-settings.service';
import { lateKey, noShowKey, recallKey, reminderKey } from './automation-keys';
import { OutboundService } from './outbound.service';

/**
 * Tolerância para trás ao enfileirar um lembrete. Um lembrete de "3 dias antes"
 * cujo momento já passou (a consulta foi marcada ontem para amanhã) não deve
 * sair agora dizendo "faltam 3 dias".
 */
const REMINDER_GRACE_MINUTES = 15;

/** Quanto tempo depois da falta a primeira tentativa de remarcação sai. */
const NO_SHOW_FIRST_DELAY_MS = 2 * 3_600_000;

/** Janela de varredura do retorno: 1 dia após a data-alvo. */
const RECALL_WINDOW_MS = 24 * 3_600_000;

/**
 * Espaço mínimo entre dois retornos para o mesmo cliente. Sem isto, quem fez
 * duas manutenções em semanas seguidas receberia duas cobranças de retorno.
 */
const RECALL_COOLDOWN_DAYS = 60;

/** Dados que os textos das automações sabem preencher. */
interface AppointmentContext {
  id: string;
  startsAt: Date | null;
  procedureName: string | null;
  professionalName: string | null;
  conversationId: string | null;
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  clinicName: string;
}

/**
 * O planejador das automações (F9): olha a agenda e decide **o que precisa ser
 * enviado**. Ele não envia nada — só enfileira, e a fila cuida da higiene.
 *
 * Roda periodicamente e é seguro repetir: cada disparo tem chave de
 * idempotência, então uma rodada que se sobreponha à anterior não duplica nada.
 * Essa é a razão de existir um planejador varrendo estado em vez de gatilhos
 * disparados no momento do agendamento: estado pode ser reconciliado depois de
 * uma queda, um evento perdido é perdido para sempre.
 */
@Injectable()
export class AutomationPlannerService {
  private readonly logger = new Logger(AutomationPlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AutomationSettingsService,
    private readonly outbound: OutboundService,
  ) {}

  /** Planeja para todas as empresas que têm WhatsApp conectado. */
  async planAll(now = new Date()): Promise<number> {
    const clinics = await this.prisma.clinicSettings.findMany({
      where: { whatsappInstance: { not: null } },
      select: { clinicId: true },
    });

    let enqueued = 0;
    for (const { clinicId } of clinics) {
      try {
        enqueued += await this.planForClinic(clinicId, now);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Falha ao planejar automações da empresa ${clinicId}: ${detail}`,
        );
      }
    }
    return enqueued;
  }

  async planForClinic(clinicId: string, now = new Date()): Promise<number> {
    const settings = await this.settings.get(clinicId);
    let enqueued = 0;
    enqueued += await this.planReminders(clinicId, settings, now);
    enqueued += await this.planLate(clinicId, settings, now);
    enqueued += await this.planNoShow(clinicId, settings, now);
    enqueued += await this.planRecall(clinicId, settings, now);
    return enqueued;
  }

  // ─── ① lembretes: 3 dias, 1 dia e 1 hora antes ────────────────────────────

  private async planReminders(
    clinicId: string,
    settings: AutomationSettings,
    now: Date,
  ): Promise<number> {
    const rules = [
      { kind: 'lembrete_3d' as const, rule: settings.lembrete3d },
      { kind: 'lembrete_1d' as const, rule: settings.lembrete1d },
      { kind: 'lembrete_1h' as const, rule: settings.lembrete1h },
    ].filter(({ rule }) => rule.enabled);
    if (rules.length === 0) return 0;

    const horizon = new Date(
      now.getTime() + REMINDER_LEAD_MINUTES.lembrete_3d * 60_000,
    );
    const appointments = await this.loadAppointments(clinicId, {
      status: { in: ['agendado', 'confirmado'] },
      startsAt: { gte: now, lte: horizon },
    });

    let enqueued = 0;
    for (const appointment of appointments) {
      if (!appointment.startsAt) continue;
      for (const { kind, rule } of rules) {
        const sendAt = new Date(
          appointment.startsAt.getTime() - REMINDER_LEAD_MINUTES[kind] * 60_000,
        );
        // Momento já passou: a consulta foi marcada em cima da hora e este
        // lembrete específico perdeu o sentido. Os mais próximos ainda saem.
        if (
          sendAt.getTime() <
          now.getTime() - REMINDER_GRACE_MINUTES * 60_000
        ) {
          continue;
        }

        const result = await this.outbound.enqueue({
          clinicId,
          kind,
          dedupeKey: reminderKey(kind, appointment.id, appointment.startsAt),
          scheduledFor: sendAt,
          body: this.render(rule.template, appointment, settings.timezone),
          phone: appointment.leadPhone,
          leadId: appointment.leadId,
          conversationId: appointment.conversationId,
          appointmentId: appointment.id,
        });
        if (result === 'criado') enqueued += 1;
      }
    }
    return enqueued;
  }

  // ─── ② atraso ─────────────────────────────────────────────────────────────

  /**
   * Só alcança agendamentos vindos da **integração**, e é uma trava deliberada:
   * o aviso depende de saber que o cliente ainda não chegou, e esse sinal é o
   * status que a recepção atualiza no sistema de gestão. Um agendamento criado
   * pelo bot nunca receberá "chegou" — sem esta restrição, todo mundo que
   * marcou pelo WhatsApp levaria um aviso de atraso indevido.
   */
  private async planLate(
    clinicId: string,
    settings: AutomationSettings,
    now: Date,
  ): Promise<number> {
    if (!settings.atraso.enabled) return 0;

    const tolerance = settings.atraso.toleranceMinutes * 60_000;
    const appointments = await this.loadAppointments(clinicId, {
      source: 'integracao',
      status: { in: ['agendado', 'confirmado'] },
      startsAt: {
        // Consultas cujo horário passou da tolerância há pouco tempo. A janela
        // curta evita ressuscitar o dia inteiro se o worker ficou parado.
        gte: new Date(now.getTime() - tolerance - 60 * 60_000),
        lte: new Date(now.getTime() - tolerance),
      },
    });

    let enqueued = 0;
    for (const appointment of appointments) {
      if (!appointment.startsAt) continue;
      const result = await this.outbound.enqueue({
        clinicId,
        kind: 'atraso',
        dedupeKey: lateKey(appointment.id, appointment.startsAt),
        scheduledFor: new Date(appointment.startsAt.getTime() + tolerance),
        body: this.render(
          settings.atraso.template,
          appointment,
          settings.timezone,
        ),
        phone: appointment.leadPhone,
        leadId: appointment.leadId,
        conversationId: appointment.conversationId,
        appointmentId: appointment.id,
      });
      if (result === 'criado') enqueued += 1;
    }
    return enqueued;
  }

  // ─── ③ falta: tenta remarcar, com teto ────────────────────────────────────

  private async planNoShow(
    clinicId: string,
    settings: AutomationSettings,
    now: Date,
  ): Promise<number> {
    if (!settings.falta.enabled) return 0;

    const lookback = new Date(
      now.getTime() -
        settings.falta.attempts * settings.falta.intervalHours * 3_600_000 -
        24 * 3_600_000,
    );
    const appointments = await this.loadAppointments(clinicId, {
      status: 'faltou',
      startsAt: { gte: lookback, lte: now },
    });

    let enqueued = 0;
    for (const appointment of appointments) {
      if (!appointment.startsAt) continue;

      const previous = await this.prisma.outboundMessage.findMany({
        where: { clinicId, appointmentId: appointment.id, kind: 'falta' },
        orderBy: { attempt: 'desc' },
        take: 1,
        select: { attempt: true, status: true, sentAt: true, reason: true },
      });
      const last = previous[0];

      // Teto rígido de tentativas — o limite entre retomar o contato e
      // perseguir. Nada aqui pode ultrapassá-lo.
      const nextAttempt = last ? last.attempt + 1 : 1;
      if (nextAttempt > settings.falta.attempts) continue;

      if (last) {
        // A cadência para se o cliente respondeu (a fila já suprime nesse caso)
        // ou se a anterior ainda não saiu.
        if (last.status !== 'enviado' || !last.sentAt) continue;
        const elapsed = now.getTime() - last.sentAt.getTime();
        if (elapsed < settings.falta.intervalHours * 3_600_000) continue;
        if (await this.repliedAfter(appointment.conversationId, last.sentAt)) {
          continue;
        }
      }

      const scheduledFor = last
        ? now
        : new Date(appointment.startsAt.getTime() + NO_SHOW_FIRST_DELAY_MS);

      const result = await this.outbound.enqueue({
        clinicId,
        kind: 'falta',
        dedupeKey: noShowKey(appointment.id, nextAttempt),
        scheduledFor: scheduledFor > now ? scheduledFor : now,
        body: this.render(
          settings.falta.template,
          appointment,
          settings.timezone,
        ),
        phone: appointment.leadPhone,
        leadId: appointment.leadId,
        conversationId: appointment.conversationId,
        appointmentId: appointment.id,
        attempt: nextAttempt,
      });
      if (result === 'criado') enqueued += 1;
    }
    return enqueued;
  }

  // ─── ④ retorno: fez manutenção e não deixou a próxima marcada ─────────────

  private async planRecall(
    clinicId: string,
    settings: AutomationSettings,
    now: Date,
  ): Promise<number> {
    if (!settings.retorno.enabled) return 0;

    const target = now.getTime() - settings.retorno.afterDays * 24 * 3_600_000;
    const appointments = await this.loadAppointments(clinicId, {
      status: 'compareceu',
      startsAt: {
        gte: new Date(target - RECALL_WINDOW_MS),
        lte: new Date(target),
      },
    });

    let enqueued = 0;
    for (const appointment of appointments) {
      if (!appointment.leadId) continue;
      if (
        !matchesRecallProcedure(appointment, settings.retorno.procedureKeywords)
      ) {
        continue;
      }
      // O ponto do pedido: só entra em contato quem **saiu sem deixar a próxima
      // marcada**. Consulta futura já agendada encerra o assunto.
      if (await this.hasFutureAppointment(clinicId, appointment.leadId, now)) {
        continue;
      }
      if (await this.recalledRecently(clinicId, appointment.leadId, now)) {
        continue;
      }

      const result = await this.outbound.enqueue({
        clinicId,
        kind: 'retorno',
        dedupeKey: recallKey(appointment.id),
        scheduledFor: now,
        body: this.render(
          settings.retorno.template,
          appointment,
          settings.timezone,
        ),
        phone: appointment.leadPhone,
        leadId: appointment.leadId,
        conversationId: appointment.conversationId,
        appointmentId: appointment.id,
      });
      if (result === 'criado') enqueued += 1;
    }
    return enqueued;
  }

  // ─── apoio ────────────────────────────────────────────────────────────────

  private async loadAppointments(
    clinicId: string,
    where: Record<string, unknown>,
  ): Promise<AppointmentContext[]> {
    const rows = await this.prisma.appointment.findMany({
      where: { clinicId, ...where },
      select: {
        id: true,
        startsAt: true,
        professionalName: true,
        conversationId: true,
        leadId: true,
        procedure: { select: { name: true } },
        notes: true,
        lead: { select: { name: true, phone: true } },
        clinic: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });

    return rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      // Sem catálogo casado, o nome do procedimento que veio da agenda externa
      // fica nas observações — é melhor do que um lembrete genérico.
      procedureName: row.procedure?.name ?? row.notes ?? null,
      professionalName: row.professionalName,
      conversationId: row.conversationId,
      leadId: row.leadId,
      leadName: row.lead?.name ?? null,
      leadPhone: row.lead?.phone ?? null,
      clinicName: row.clinic.name,
    }));
  }

  private async repliedAfter(
    conversationId: string | null,
    since: Date,
  ): Promise<boolean> {
    if (!conversationId) return false;
    const reply = await this.prisma.message.findFirst({
      where: { conversationId, role: 'user', createdAt: { gt: since } },
      select: { id: true },
    });
    return reply !== null;
  }

  private async hasFutureAppointment(
    clinicId: string,
    leadId: string,
    now: Date,
  ): Promise<boolean> {
    const future = await this.prisma.appointment.findFirst({
      where: {
        clinicId,
        leadId,
        startsAt: { gt: now },
        status: { in: ['agendado', 'confirmado'] },
      },
      select: { id: true },
    });
    return future !== null;
  }

  private async recalledRecently(
    clinicId: string,
    leadId: string,
    now: Date,
  ): Promise<boolean> {
    const since = new Date(
      now.getTime() - RECALL_COOLDOWN_DAYS * 24 * 3_600_000,
    );
    const recent = await this.prisma.outboundMessage.findFirst({
      where: {
        clinicId,
        leadId,
        kind: 'retorno',
        status: { in: ['pendente', 'enviado'] },
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    return recent !== null;
  }

  private render(
    template: string,
    appointment: AppointmentContext,
    timeZone: string,
  ): string {
    return renderTemplate(template, {
      nome: firstName(appointment.leadName) ?? '',
      empresa: appointment.clinicName,
      data: appointment.startsAt
        ? formatDatePtBr(appointment.startsAt, timeZone)
        : '',
      hora: appointment.startsAt
        ? formatTimePtBr(appointment.startsAt, timeZone)
        : '',
      procedimento: appointment.procedureName ?? '',
      profissional: appointment.professionalName ?? '',
    });
  }
}

/** Primeiro nome — um lembrete que chama pelo nome completo soa como cobrança. */
function firstName(name: string | null): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

/**
 * O procedimento conta como "manutenção" para esta empresa? Comparação sem
 * acento e sem caixa, porque a mesma clínica escreve "Manutenção", "manutencao"
 * e "MANUTENÇÃO PERIÓDICA" no mesmo cadastro.
 */
export function matchesRecallProcedure(
  appointment: { procedureName: string | null },
  keywords: string[],
): boolean {
  if (keywords.length === 0) return false;
  const name = normalize(appointment.procedureName ?? '');
  if (!name) return false;
  return keywords.some((keyword) => {
    const normalized = normalize(keyword);
    return normalized.length > 0 && name.includes(normalized);
  });
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
