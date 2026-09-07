import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AutomationHistoryQuery,
  AutomationKind,
  AutomationSettings,
  OutboundMessageSummary,
  OutboundSuppressionReason,
  UpdateOutboundMessageInput,
} from '@dentaltrack/shared';
import {
  isZonedWeekend,
  parseHhMm,
  startOfZonedDay,
  toZonedParts,
  zonedMinutesOfDay,
  zonedTimeToUtc,
} from '../common/time';
import type { Env } from '../config/env.validation';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from '../whatsapp/evolution.service';
import { AutomationSettingsService } from './automation-settings.service';
import { reminderKey } from './automation-keys';
import { HolidaysService } from './holidays.service';
import { OptOutService } from './opt-out.service';

/**
 * Quanto cada tipo tolera ser adiado para caber na janela de envio.
 *
 * A distinção importa: um lembrete de 3 dias pode muito bem sair na manhã
 * seguinte, mas um "sua consulta é daqui a 1 hora" empurrado para o dia
 * seguinte é pior do que não enviar — chega depois do fato, confunde, e gasta a
 * confiança do cliente na mensagem automática. Passou do limite, suprime.
 */
const MAX_DELAY_MINUTES: Record<AutomationKind, number> = {
  lembrete_3d: 24 * 60,
  lembrete_1d: 14 * 60,
  lembrete_1h: 45,
  atraso: 30,
  falta: 24 * 60,
  retorno: 72 * 60,
};

const DEFAULT_THROTTLE_MS = 4_000;
const DEFAULT_BATCH_SIZE = 20;
/** Reenvios por falha de transporte antes de desistir. */
const MAX_TRANSPORT_RETRIES = 2;
const RETRY_DELAY_MS = 10 * 60_000;

export interface EnqueueInput {
  clinicId: string;
  kind: AutomationKind;
  dedupeKey: string;
  /** Quando o disparo faz sentido; a janela pode empurrá-lo para frente. */
  scheduledFor: Date;
  body: string;
  phone: string | null;
  leadId?: string | null;
  conversationId?: string | null;
  appointmentId?: string | null;
  /** Tentativa da cadência (só a falta usa > 1). */
  attempt?: number;
}

export type EnqueueResult = 'criado' | 'duplicado' | 'suprimido';

/** Projeção comum de uma linha da fila para o formato que a UI consome. */
const SUMMARY_SELECT = {
  id: true,
  kind: true,
  status: true,
  reason: true,
  scheduledFor: true,
  sentAt: true,
  attempt: true,
  body: true,
  phone: true,
  conversationId: true,
  appointmentId: true,
  lead: { select: { name: true } },
} as const;

interface SummaryRow {
  id: string;
  kind: AutomationKind;
  status: OutboundMessageSummary['status'];
  reason: string | null;
  scheduledFor: Date;
  sentAt: Date | null;
  attempt: number;
  body: string;
  phone: string | null;
  conversationId: string | null;
  appointmentId: string | null;
  lead: { name: string | null } | null;
}

export interface DispatchSummary {
  enviados: number;
  suprimidos: number;
  falhas: number;
}

/**
 * Fila de saída das automações (F9) — onde toda mensagem proativa nasce e de
 * onde ela sai.
 *
 * Centralizar isto foi uma decisão, não uma conveniência: as quatro automações
 * têm gatilhos diferentes mas exigem exatamente a mesma higiene, e o canal é um
 * WhatsApp não-oficial (Baileys), onde disparo mal calibrado não degrada o
 * recurso — **derruba o número da empresa inteira**, com a agenda dela dentro.
 * Janela de horário, feriado, teto diário, espaçamento entre envios,
 * descadastro e idempotência moram todos aqui, uma vez só.
 */
@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AutomationSettingsService,
    private readonly holidays: HolidaysService,
    private readonly optOut: OptOutService,
    private readonly evolution: EvolutionService,
    private readonly conversations: ConversationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Enfileira um disparo. Idempotente pela `dedupeKey`: chamar de novo com a
   * mesma chave não cria uma segunda mensagem — é o que permite ao planejador
   * rodar de 5 em 5 minutos sem medo.
   *
   * Contato sem telefone ou descadastrado **também vira linha**, com status
   * `suprimido` e o motivo: o dono precisa enxergar que o lembrete não saiu e
   * por quê, em vez de olhar para uma fila vazia sem explicação.
   */
  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    const existing = await this.prisma.outboundMessage.findUnique({
      where: {
        clinicId_dedupeKey: {
          clinicId: input.clinicId,
          dedupeKey: input.dedupeKey,
        },
      },
      select: { id: true },
    });
    if (existing) return 'duplicado';

    const settings = await this.settings.get(input.clinicId);
    const phone = OptOutService.normalizePhone(input.phone);

    const suppression = await this.preflight(input.clinicId, phone);
    if (suppression) {
      await this.create(input, input.scheduledFor, phone, suppression);
      return 'suprimido';
    }

    const slot = await this.nextAllowedSlot(
      input.clinicId,
      input.scheduledFor,
      settings,
    );
    const delayMinutes =
      (slot.getTime() - input.scheduledFor.getTime()) / 60_000;
    if (delayMinutes > MAX_DELAY_MINUTES[input.kind]) {
      await this.create(input, slot, phone, 'fora_da_janela');
      return 'suprimido';
    }

    await this.create(input, slot, phone, null);
    return 'criado';
  }

  /**
   * Despacha o que está vencido. Sequencial e espaçado de propósito: rajada de
   * mensagens idênticas no mesmo minuto é o padrão que a plataforma reconhece
   * como robô.
   */
  async dispatchDue(now = new Date()): Promise<DispatchSummary> {
    const summary: DispatchSummary = { enviados: 0, suprimidos: 0, falhas: 0 };
    if (!this.enabled()) return summary;

    const due = await this.prisma.outboundMessage.findMany({
      where: { status: 'pendente', scheduledFor: { lte: now } },
      orderBy: { scheduledFor: 'asc' },
      take: this.batchSize(),
    });
    if (due.length === 0) return summary;

    for (const message of due) {
      const reason = await this.revalidate(message);
      if (reason) {
        await this.suppress(message.id, reason);
        summary.suprimidos += 1;
        continue;
      }

      const sent = await this.deliver(message);
      if (sent === 'enviado') summary.enviados += 1;
      else if (sent === 'suprimido') summary.suprimidos += 1;
      else summary.falhas += 1;

      if (sent === 'enviado') await this.pause();
    }

    return summary;
  }

  /**
   * Histórico do que a empresa disparou. Inclui o que foi **suprimido** e o
   * motivo — é a diferença entre "o lembrete não chegou" e "o lembrete não foi
   * enviado porque o cliente pediu para parar".
   */
  async history(
    clinicId: string,
    query: AutomationHistoryQuery,
  ): Promise<OutboundMessageSummary[]> {
    const rows = await this.prisma.outboundMessage.findMany({
      where: {
        clinicId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      select: SUMMARY_SELECT,
    });

    return rows.map((row) => this.summarize(row));
  }

  /**
   * Edita e/ou adia uma mensagem **pendente** — o painel de mensagens
   * programadas na `/agenda`. O novo horário passa pela mesma janela de envio
   * das automações (`nextAllowedSlot`): a higiene anti-ban não abre exceção
   * nem para ajuste manual.
   */
  async updatePending(
    clinicId: string,
    id: string,
    input: UpdateOutboundMessageInput,
  ): Promise<OutboundMessageSummary> {
    const row = await this.requirePending(clinicId, id);

    let scheduledFor = row.scheduledFor;
    if (input.scheduledFor !== undefined) {
      const desired = new Date(input.scheduledFor);
      if (Number.isNaN(desired.getTime())) {
        throw new BadRequestException('Horário inválido.');
      }
      if (desired.getTime() < Date.now() - 60_000) {
        throw new BadRequestException('O novo horário já passou.');
      }
      const settings = await this.settings.get(clinicId);
      scheduledFor = await this.nextAllowedSlot(clinicId, desired, settings);
    }

    const updated = await this.prisma.outboundMessage.update({
      where: { id: row.id },
      data: {
        ...(input.body !== undefined ? { body: input.body } : {}),
        scheduledFor,
      },
      select: SUMMARY_SELECT,
    });
    return this.summarize(updated);
  }

  /** Cancela uma mensagem pendente — ela vira registro, não some da lista. */
  async cancelPending(
    clinicId: string,
    id: string,
  ): Promise<OutboundMessageSummary> {
    const row = await this.requirePending(clinicId, id);
    const updated = await this.prisma.outboundMessage.update({
      where: { id: row.id },
      data: { status: 'cancelado' },
      select: SUMMARY_SELECT,
    });
    return this.summarize(updated);
  }

  /** A mensagem existe, é desta empresa e ainda não saiu? */
  private async requirePending(
    clinicId: string,
    id: string,
  ): Promise<{ id: string; status: string; scheduledFor: Date }> {
    const row = await this.prisma.outboundMessage.findFirst({
      where: { id, clinicId },
      select: { id: true, status: true, scheduledFor: true },
    });
    if (!row) throw new NotFoundException('Mensagem não encontrada.');
    if (row.status !== 'pendente') {
      throw new BadRequestException(
        'Só mensagens pendentes podem ser alteradas ou canceladas.',
      );
    }
    return row;
  }

  private summarize(row: SummaryRow): OutboundMessageSummary {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      reason: (row.reason as OutboundSuppressionReason | null) ?? null,
      scheduledFor: row.scheduledFor.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      attempt: row.attempt,
      body: row.body,
      leadName: row.lead?.name ?? null,
      phone: row.phone,
      conversationId: row.conversationId,
      appointmentId: row.appointmentId,
    };
  }

  /**
   * Motivos que impedem o disparo **antes** mesmo de entrar na fila ativa.
   * Verificar aqui evita ocupar a fila com o que nunca poderia sair.
   */
  private async preflight(
    clinicId: string,
    phone: string | null,
  ): Promise<OutboundSuppressionReason | null> {
    if (!phone) return 'sem_telefone';
    if (await this.optOut.isOptedOut(clinicId, phone)) return 'opt_out';

    const settings = await this.prisma.clinicSettings.findUnique({
      where: { clinicId },
      select: { whatsappInstance: true },
    });
    if (!settings?.whatsappInstance || !this.evolution.isConfigured()) {
      return 'whatsapp_nao_configurado';
    }
    return null;
  }

  /**
   * Revalidação no momento do envio. A mensagem foi montada horas (ou dias)
   * antes; entre lá e aqui a consulta pode ter sido remarcada ou cancelada e o
   * cliente pode ter respondido. Enviar assim mesmo é o erro que faz o cliente
   * perder a confiança em tudo o que o sistema manda.
   */
  private async revalidate(message: {
    id: string;
    clinicId: string;
    kind: AutomationKind;
    dedupeKey: string;
    phone: string | null;
    conversationId: string | null;
    appointmentId: string | null;
    createdAt: Date;
  }): Promise<OutboundSuppressionReason | null> {
    if (await this.optOut.isOptedOut(message.clinicId, message.phone)) {
      return 'opt_out';
    }

    if (message.appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: message.appointmentId, clinicId: message.clinicId },
        select: { status: true, startsAt: true },
      });
      if (!appointment || appointment.status === 'cancelado') {
        return 'agendamento_mudou';
      }

      if (isReminderKind(message.kind)) {
        // Remarcação: a chave carrega o horário planejado. Se o agendamento
        // mudou, a chave não bate mais — e o lembrete certo já foi enfileirado
        // com a chave nova pelo planejador.
        const expected = appointment.startsAt
          ? reminderKey(
              message.kind,
              message.appointmentId,
              appointment.startsAt,
            )
          : null;
        if (expected !== message.dedupeKey) return 'agendamento_mudou';
        if (
          appointment.startsAt &&
          appointment.startsAt.getTime() < Date.now()
        ) {
          return 'agendamento_mudou';
        }
      }

      if (
        message.kind === 'atraso' &&
        appointment.status !== 'agendado' &&
        appointment.status !== 'confirmado'
      ) {
        // O cliente chegou (ou o agendamento saiu do ar) entre o agendamento do
        // aviso e agora: avisar de atraso quem já está na cadeira é o pior erro
        // possível desta automação.
        return 'agendamento_mudou';
      }

      if (message.kind === 'falta' && appointment.status !== 'faltou') {
        return 'agendamento_mudou';
      }
    }

    // Cadência que insiste: para na primeira resposta do cliente. É o limite
    // entre "retomar o contato" e perseguir.
    if (
      (message.kind === 'falta' || message.kind === 'retorno') &&
      message.conversationId
    ) {
      const replied = await this.prisma.message.findFirst({
        where: {
          conversationId: message.conversationId,
          role: 'user',
          createdAt: { gt: message.createdAt },
        },
        select: { id: true },
      });
      if (replied) return 'cliente_respondeu';
    }

    return null;
  }

  /** Envia de fato, persiste na conversa e marca o resultado. */
  private async deliver(message: {
    id: string;
    clinicId: string;
    kind: AutomationKind;
    body: string;
    phone: string | null;
    conversationId: string | null;
    retries: number;
  }): Promise<'enviado' | 'suprimido' | 'falhou'> {
    const clinic = await this.prisma.clinicSettings.findUnique({
      where: { clinicId: message.clinicId },
      select: { whatsappInstance: true },
    });
    const instance = clinic?.whatsappInstance;
    if (!instance || !message.phone || !this.evolution.isConfigured()) {
      await this.suppress(message.id, 'whatsapp_nao_configurado');
      return 'suprimido';
    }

    if (await this.reachedDailyCap(message.clinicId)) {
      await this.suppress(message.id, 'teto_diario');
      return 'suprimido';
    }

    try {
      const target =
        (await this.evolution.resolveLidJid(
          instance,
          `${message.phone}@s.whatsapp.net`,
        )) ?? message.phone;
      await this.evolution.sendText(instance, target, message.body);
    } catch (err) {
      return this.handleFailure(message, err);
    }

    // A mensagem entra na conversa do contato: a resposta cai no mesmo fio e o
    // agente assume dali com todo o histórico. Sem isso, o cliente responderia
    // a um lembrete que o bot não sabe que existiu.
    const conversationId =
      message.conversationId ??
      (
        await this.conversations.resolveByPhone(
          message.clinicId,
          'whatsapp',
          message.phone,
        )
      ).id;

    await this.conversations.appendMessage(
      conversationId,
      'assistant',
      message.body,
      {},
      message.clinicId,
    );
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, status: 'abandonada' },
      data: { status: 'em_andamento' },
    });

    await this.prisma.outboundMessage.update({
      where: { id: message.id },
      data: {
        status: 'enviado',
        sentAt: new Date(),
        conversationId,
        error: null,
      },
    });
    return 'enviado';
  }

  /** Falha de transporte: reagenda algumas vezes antes de desistir. */
  private async handleFailure(
    message: { id: string; retries: number; kind: AutomationKind },
    err: unknown,
  ): Promise<'falhou'> {
    const detail = err instanceof Error ? err.message : String(err);
    const canRetry = message.retries < MAX_TRANSPORT_RETRIES;
    this.logger.error(
      `Falha ao enviar automação ${message.kind} (${message.id}): ${detail}`,
    );
    await this.prisma.outboundMessage.update({
      where: { id: message.id },
      data: canRetry
        ? {
            retries: { increment: 1 },
            scheduledFor: new Date(Date.now() + RETRY_DELAY_MS),
            error: detail.slice(0, 500),
          }
        : { status: 'falhou', error: detail.slice(0, 500) },
    });
    return 'falhou';
  }

  /**
   * Primeiro instante, a partir do desejado, que respeita janela de envio,
   * fim de semana e feriado. Percorre no máximo 14 dias — um recesso longo não
   * pode virar laço infinito.
   */
  async nextAllowedSlot(
    clinicId: string,
    desired: Date,
    settings: AutomationSettings,
  ): Promise<Date> {
    const tz = settings.timezone;
    const windowStart = parseHhMm(settings.sendWindowStart, 8 * 60);
    const windowEnd = parseHhMm(settings.sendWindowEnd, 20 * 60);
    let candidate = new Date(desired);

    for (let guard = 0; guard < 14; guard += 1) {
      if (settings.skipWeekends && isZonedWeekend(candidate, tz)) {
        candidate = this.nextDayAt(candidate, windowStart, tz);
        continue;
      }
      if (
        settings.skipHolidays &&
        (await this.holidays.isHoliday(clinicId, candidate, tz))
      ) {
        candidate = this.nextDayAt(candidate, windowStart, tz);
        continue;
      }

      const minutes = zonedMinutesOfDay(candidate, tz);
      if (minutes < windowStart) {
        candidate = this.sameDayAt(candidate, windowStart, tz);
        continue;
      }
      if (minutes > windowEnd) {
        candidate = this.nextDayAt(candidate, windowStart, tz);
        continue;
      }
      return candidate;
    }
    return candidate;
  }

  /** Já batemos o teto de mensagens automáticas do dia? */
  private async reachedDailyCap(clinicId: string): Promise<boolean> {
    const settings = await this.settings.get(clinicId);
    const since = startOfZonedDay(new Date(), settings.timezone);
    const sent = await this.prisma.outboundMessage.count({
      where: { clinicId, status: 'enviado', sentAt: { gte: since } },
    });
    if (sent >= settings.dailyCap) {
      this.logger.warn(
        `Empresa ${clinicId} atingiu o teto diário de ${settings.dailyCap} mensagens automáticas.`,
      );
      return true;
    }
    return false;
  }

  private async create(
    input: EnqueueInput,
    scheduledFor: Date,
    phone: string | null,
    suppression: OutboundSuppressionReason | null,
  ): Promise<void> {
    await this.prisma.outboundMessage.create({
      data: {
        clinicId: input.clinicId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        scheduledFor,
        body: input.body,
        phone,
        leadId: input.leadId ?? null,
        conversationId: input.conversationId ?? null,
        appointmentId: input.appointmentId ?? null,
        attempt: input.attempt ?? 1,
        ...(suppression
          ? { status: 'suprimido' as const, reason: suppression }
          : {}),
      },
    });
  }

  private async suppress(
    id: string,
    reason: OutboundSuppressionReason,
  ): Promise<void> {
    await this.prisma.outboundMessage.update({
      where: { id },
      data: { status: 'suprimido', reason },
    });
  }

  private sameDayAt(date: Date, minutes: number, tz: string): Date {
    const p = toZonedParts(date, tz);
    return zonedTimeToUtc(
      {
        year: p.year,
        month: p.month,
        day: p.day,
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
      },
      tz,
    );
  }

  private nextDayAt(date: Date, minutes: number, tz: string): Date {
    const p = toZonedParts(date, tz);
    return zonedTimeToUtc(
      {
        year: p.year,
        month: p.month,
        day: p.day + 1,
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
      },
      tz,
    );
  }

  /** Espaçamento entre envios, com variação — cadência humana, não metrônomo. */
  private async pause(): Promise<void> {
    const base =
      this.config.get('OUTBOUND_THROTTLE_MS', { infer: true }) ??
      DEFAULT_THROTTLE_MS;
    if (base <= 0) return;
    const jitter = Math.random() * base * 0.5;
    await new Promise((resolve) => setTimeout(resolve, base + jitter));
  }

  private batchSize(): number {
    return (
      this.config.get('OUTBOUND_BATCH_SIZE', { infer: true }) ??
      DEFAULT_BATCH_SIZE
    );
  }

  private enabled(): boolean {
    return this.config.get('AUTOMATIONS_ENABLED', { infer: true }) !== false;
  }
}

function isReminderKind(
  kind: AutomationKind,
): kind is 'lembrete_3d' | 'lembrete_1d' | 'lembrete_1h' {
  return (
    kind === 'lembrete_3d' || kind === 'lembrete_1d' || kind === 'lembrete_1h'
  );
}
