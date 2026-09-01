import { Injectable, Logger } from '@nestjs/common';
import type {
  AgendaQuery,
  AgendaResponse,
  AppointmentSummary,
  Availability,
} from '@dentaltrack/shared';
import { dateKeyToUtc, DEFAULT_TIMEZONE } from '../common/time';
import { IntegrationService } from '../clinicorp/integration.service';
import { PrismaService } from '../prisma/prisma.service';

/** Quantos dias à frente a consulta de disponibilidade varre por padrão. */
const DEFAULT_AVAILABILITY_DAYS = 10;
/** Quantos horários o agente recebe por vez — lista longa confunde no WhatsApp. */
const DEFAULT_SLOT_LIMIT = 6;
/** Duração assumida quando o procedimento não declara a dele. */
const DEFAULT_DURATION_MINUTES = 30;

export interface BookInput {
  conversationId: string | null;
  leadId: string | null;
  procedureId: string | null;
  procedureName: string | null;
  durationMinutes: number | null;
  /** Horário acordado. `null` mantém o comportamento antigo (só preferência). */
  startsAt: Date | null;
  preferredTime: string | null;
  patientName: string | null;
  patientPhone: string | null;
  professionalId?: string | null;
  unitId?: string | null;
}

export interface BookResult {
  appointmentId: string;
  startsAt: Date | null;
  /**
   * `true` só quando o horário foi gravado na **agenda real** da empresa. É o
   * que autoriza o agente a dizer "está marcado" em vez de "vou confirmar":
   * prometer confirmação que não existe é o pior desfecho possível aqui.
   */
  confirmed: boolean;
  externalId: string | null;
}

/**
 * Agenda (F9) — a fachada entre o produto e a agenda da empresa.
 *
 * Serve o agente (disponibilidade e agendamento), a tela e a sincronização.
 * Não conhece o Clinicorp: pede um `AgendaProvider` ao `IntegrationService` e,
 * quando não há nenhum, degrada para o comportamento pré-F9 — o que mantém o
 * produto funcionando em empresas sem sistema de gestão integrado.
 */
@Injectable()
export class AgendaService {
  private readonly logger = new Logger(AgendaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationService,
  ) {}

  /**
   * Horários realmente livres. Sem integração devolve lista vazia com
   * `live: false` — e isso é deliberado: inventar horários a partir do quadro
   * declarado em `/settings` ("Segunda a sexta, 08:00 – 18:00") produziria
   * ofertas que a recepção não pode honrar, que é exatamente o problema que o
   * cliente pediu para resolver.
   */
  async getAvailability(
    clinicId: string,
    options: {
      from?: Date;
      days?: number;
      durationMinutes?: number | null;
      limit?: number;
    } = {},
  ): Promise<Availability> {
    const provider = await this.integrations.getProvider(clinicId);
    if (!provider) return { slots: [], live: false };

    const from = options.from ?? new Date();
    const to = new Date(
      from.getTime() +
        (options.days ?? DEFAULT_AVAILABILITY_DAYS) * 24 * 3_600_000,
    );

    try {
      const slots = await provider.listAvailableSlots({
        from,
        to,
        durationMinutes: options.durationMinutes ?? null,
        limit: options.limit ?? DEFAULT_SLOT_LIMIT,
      });
      return { slots, live: provider.live };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Não foi possível consultar a agenda da empresa ${clinicId}: ${detail}`,
      );
      // Agenda fora do ar não pode derrubar o atendimento: o agente continua a
      // conversa coletando a preferência, como fazia antes da integração.
      return { slots: [], live: false };
    }
  }

  /**
   * Registra o agendamento. Com integração e horário definido, grava também na
   * agenda real; sem uma coisa ou outra, grava só aqui — e `confirmed` diz ao
   * chamador qual dos dois mundos aconteceu.
   */
  async book(clinicId: string, input: BookInput): Promise<BookResult> {
    const provider = await this.integrations.getProvider(clinicId);
    const duration = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;

    let externalId: string | null = null;
    let professionalName: string | null = null;
    let confirmed = false;

    if (provider && input.startsAt && input.patientName) {
      try {
        const patient =
          (await provider.findPatient({
            phone: input.patientPhone,
            name: input.patientName,
          })) ??
          (await provider.createPatient({
            name: input.patientName,
            phone: input.patientPhone,
          }));

        const created = await provider.createAppointment({
          patientId: patient.id,
          patientName: input.patientName,
          patientPhone: input.patientPhone,
          startsAt: input.startsAt,
          endsAt: new Date(input.startsAt.getTime() + duration * 60_000),
          unitId:
            input.unitId ?? (await this.defaultUnitId(clinicId, provider)),
          professionalId:
            input.professionalId ??
            (await this.defaultProfessionalId(clinicId, provider)),
          procedureName: input.procedureName,
        });
        externalId = created.externalId;
        professionalName = created.professionalName;
        confirmed = true;

        if (input.leadId && patient.id) {
          await this.linkLeadToPatient(clinicId, input.leadId, patient.id);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        // Registra o pedido mesmo assim: perder o interesse do cliente por uma
        // falha de integração seria pior. `confirmed` fica false e o agente
        // promete retorno em vez de confirmar.
        this.logger.error(
          `Falha ao gravar o agendamento na agenda da empresa ${clinicId}: ${detail}`,
        );
      }
    }

    const appointment = await this.prisma.appointment.create({
      data: {
        clinicId,
        conversationId: input.conversationId,
        leadId: input.leadId,
        procedureId: input.procedureId,
        preferredTime: input.preferredTime,
        startsAt: input.startsAt,
        endsAt: input.startsAt
          ? new Date(input.startsAt.getTime() + duration * 60_000)
          : null,
        status: input.startsAt ? 'agendado' : 'pedido',
        source: confirmed ? 'integracao' : 'bot',
        externalId,
        professionalName,
        unitExternalId: input.unitId ?? null,
        professionalExternalId: input.professionalId ?? null,
        notes: input.procedureName,
      },
      select: { id: true },
    });

    return {
      appointmentId: appointment.id,
      startsAt: input.startsAt,
      confirmed,
      externalId,
    };
  }

  /**
   * Fuso da empresa. Exposto aqui para que o motor do agente não precise
   * conhecer o módulo de integração só para formatar um horário.
   */
  timeZone(clinicId: string): Promise<string> {
    return this.integrations.timeZoneOf(clinicId);
  }

  /** Agenda da empresa numa janela — alimenta a tela. */
  async list(clinicId: string, query: AgendaQuery): Promise<AgendaResponse> {
    const timeZone = await this.integrations.timeZoneOf(clinicId);
    const from =
      (query.from ? dateKeyToUtc(query.from, timeZone) : null) ??
      startOfToday(timeZone);
    const to =
      (query.to ? dateKeyToUtc(query.to, timeZone) : null) ??
      new Date(from.getTime() + 7 * 24 * 3_600_000);

    const rows = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        ...(query.status ? { status: query.status } : {}),
        // Pedidos sem horário não pertencem a uma janela de datas; a tela os
        // mostra por outra via (o funil), não aqui.
        startsAt: { gte: from, lte: new Date(to.getTime() + 24 * 3_600_000) },
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
      select: {
        id: true,
        status: true,
        source: true,
        startsAt: true,
        endsAt: true,
        preferredTime: true,
        professionalName: true,
        externalId: true,
        createdAt: true,
        conversationId: true,
        leadId: true,
        procedure: { select: { name: true } },
        notes: true,
        lead: { select: { name: true, phone: true } },
      },
    });

    const integration = await this.integrations.activeStatus(clinicId);

    return {
      lastSyncedAt: integration.lastSyncedAt,
      appointments: rows.map(
        (row): AppointmentSummary => ({
          id: row.id,
          status: row.status,
          source: row.source,
          startsAt: row.startsAt?.toISOString() ?? null,
          endsAt: row.endsAt?.toISOString() ?? null,
          preferredTime: row.preferredTime,
          procedureName: row.procedure?.name ?? row.notes ?? null,
          professionalName: row.professionalName,
          leadId: row.leadId,
          leadName: row.lead?.name ?? null,
          leadPhone: row.lead?.phone ?? null,
          conversationId: row.conversationId,
          externalId: row.externalId,
          createdAt: row.createdAt.toISOString(),
        }),
      ),
    };
  }

  /** Guarda o id do paciente externo no lead (dedupe das próximas sincronias). */
  private async linkLeadToPatient(
    clinicId: string,
    leadId: string,
    patientId: string,
  ): Promise<void> {
    try {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { externalId: patientId },
      });
    } catch {
      // Colisão de (empresa, externalId): outro lead já carrega este paciente.
      // Não é motivo para derrubar o agendamento — só perdemos o atalho.
      this.logger.warn(
        `Paciente ${patientId} já vinculado a outro contato na empresa ${clinicId}.`,
      );
    }
  }

  private async defaultUnitId(
    clinicId: string,
    provider: { listUnits(): Promise<{ id: string }[]> },
  ): Promise<string> {
    const status = await this.integrations.activeStatus(clinicId);
    if (status.unitId) return status.unitId;
    const units = await provider.listUnits();
    const first = units[0]?.id;
    if (!first) throw new Error('A conta não tem nenhuma unidade disponível.');
    return first;
  }

  private async defaultProfessionalId(
    clinicId: string,
    provider: {
      listProfessionals(unitId?: string | null): Promise<{ id: string }[]>;
    },
  ): Promise<string> {
    const status = await this.integrations.activeStatus(clinicId);
    if (status.professionalId) return status.professionalId;
    const professionals = await provider.listProfessionals(status.unitId);
    const first = professionals[0]?.id;
    if (!first) {
      throw new Error('A conta não tem nenhum profissional disponível.');
    }
    return first;
  }
}

function startOfToday(timeZone: string): Date {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return dateKeyToUtc(key, timeZone) ?? new Date();
}
