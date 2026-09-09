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
import { bookingKey } from './appointment-keys';

/** Quantos dias à frente a consulta de disponibilidade varre por padrão. */
const DEFAULT_AVAILABILITY_DAYS = 10;
/** Quantos horários o agente recebe por vez — lista longa confunde no WhatsApp. */
const DEFAULT_SLOT_LIMIT = 6;
/** Duração assumida quando o procedimento não declara a dele. */
const DEFAULT_DURATION_MINUTES = 30;

/** Status iniciais do agendamento — literais para o Prisma inferir o enum. */
const AGENDADO = 'agendado' as const;
const PEDIDO = 'pedido' as const;

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

    const startedAt = Date.now();
    try {
      const slots = await provider.listAvailableSlots({
        from,
        to,
        durationMinutes: options.durationMinutes ?? null,
        limit: options.limit ?? DEFAULT_SLOT_LIMIT,
      });
      this.logger.log({
        event: 'agenda.availability',
        outcome: 'ok',
        durationMs: Date.now() - startedAt,
        horarios: slots.length,
      });
      return { slots, live: provider.live };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn({
        event: 'agenda.availability',
        outcome: 'fail',
        durationMs: Date.now() - startedAt,
        reason: err instanceof Error ? err.name : 'desconhecido',
      });
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
   *
   * **A ordem das escritas é a parte importante (P0.5).** Até a F12 o provedor
   * externo era chamado primeiro e o banco depois, sem chave de dedupe: um
   * timeout no `createAppointment` deixava o horário ocupado na agenda real e
   * nada aqui, e o retry criava o segundo. Agora:
   *
   * 1. grava o pedido **local** com a `bookingKey` — repetição colide no índice
   *    único e devolve o agendamento que já existe, sem tocar na agenda externa;
   * 2. só então chama o provedor;
   * 3. atualiza a **mesma** linha com o id externo.
   *
   * Falha no passo 2 deixa a linha registrada com `confirmed: false` — o
   * comportamento honesto que já existia, agora sem risco de duplicar.
   */
  async book(clinicId: string, input: BookInput): Promise<BookResult> {
    const duration = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;
    const key = bookingKey({
      conversationId: input.conversationId,
      leadId: input.leadId,
      patientPhone: input.patientPhone,
      startsAt: input.startsAt,
      procedureId: input.procedureId,
      procedureName: input.procedureName,
    });

    // 1. O pedido existe no DentalTrack antes de qualquer chamada externa.
    const local = await this.createRequest(clinicId, input, duration, key);
    if (local.reused) {
      // Repetição da mesma operação: devolve o que já existe. Nenhuma segunda
      // escrita na agenda da empresa — é exatamente o que se queria evitar.
      this.logger.log({
        event: 'agenda.book',
        outcome: 'ok',
        appointmentId: local.id,
        reaproveitado: true,
        confirmado: local.confirmed,
      });
      return {
        appointmentId: local.id,
        startsAt: local.startsAt,
        confirmed: local.confirmed,
        externalId: local.externalId,
      };
    }

    // 2. Agenda real da empresa.
    const provider = await this.integrations.getProvider(clinicId);
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
        // O pedido já está registrado (passo 1): perder o interesse do cliente
        // por uma falha de integração seria pior. `confirmed` fica false e o
        // agente promete retorno em vez de confirmar.
        this.logger.error(
          `Falha ao gravar o agendamento na agenda da empresa ${clinicId}: ${detail}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    // 3. Reconcilia a linha local com o que a agenda real devolveu.
    if (confirmed) {
      await this.prisma.appointment.update({
        where: { id: local.id },
        data: { externalId, professionalName, source: 'integracao' },
      });
    }

    // `confirmed: false` aqui é o sinal de que o pedido existe no DentalTrack e
    // **não** existe na agenda da empresa — a divergência que o suporte precisa
    // enxergar sem abrir o banco (P0.3).
    this.logger.log({
      event: 'agenda.book',
      outcome: confirmed ? 'ok' : 'fail',
      appointmentId: local.id,
      confirmado: confirmed,
      integracao: provider !== null,
      comHorario: input.startsAt !== null,
    });

    return {
      appointmentId: local.id,
      startsAt: input.startsAt,
      confirmed,
      externalId,
    };
  }

  /**
   * Grava o pedido local, ou devolve o que já existe para a mesma chave.
   *
   * O índice único `(clinic_id, booking_key)` **é** o controle de concorrência:
   * duas chamadas simultâneas com a mesma chave disputam o índice, uma vence e a
   * outra recebe `P2002` — momento em que a linha vencedora já está commitada e
   * pode ser lida. Não há advisory lock aqui de propósito: ele seria redundante
   * com a constraint (diferente do `OnboardingService`, que provisiona duas
   * tabelas e não tem índice em que se apoiar).
   */
  private async createRequest(
    clinicId: string,
    input: BookInput,
    duration: number,
    bookingKeyValue: string | null,
  ): Promise<{
    id: string;
    reused: boolean;
    startsAt: Date | null;
    confirmed: boolean;
    externalId: string | null;
  }> {
    const data = {
      clinicId,
      conversationId: input.conversationId,
      leadId: input.leadId,
      procedureId: input.procedureId,
      preferredTime: input.preferredTime,
      startsAt: input.startsAt,
      endsAt: input.startsAt
        ? new Date(input.startsAt.getTime() + duration * 60_000)
        : null,
      // Mantém o status de antes da P0.5: sem integração, um agendamento com
      // horário já nasce `agendado`. Promovê-lo só no passo 3 faria empresas
      // sem sistema de gestão pararem de receber lembretes, que o planner
      // busca por `status in (agendado, confirmado)`.
      status: input.startsAt ? AGENDADO : PEDIDO,
      source: 'bot' as const,
      unitExternalId: input.unitId ?? null,
      professionalExternalId: input.professionalId ?? null,
      notes: input.procedureName,
      bookingKey: bookingKeyValue,
    };

    try {
      const created = await this.prisma.appointment.create({
        data,
        select: { id: true },
      });
      return {
        id: created.id,
        reused: false,
        startsAt: input.startsAt,
        confirmed: false,
        externalId: null,
      };
    } catch (err) {
      if (!bookingKeyValue || !isUniqueViolation(err)) throw err;

      const existing = await this.prisma.appointment.findFirst({
        where: { clinicId, bookingKey: bookingKeyValue },
        select: { id: true, startsAt: true, source: true, externalId: true },
      });
      // Colisão sem linha correspondente não deveria acontecer; se acontecer,
      // engolir o erro esconderia um problema real de dados.
      if (!existing) throw err;

      return {
        id: existing.id,
        reused: true,
        startsAt: existing.startsAt,
        confirmed: existing.source === 'integracao',
        externalId: existing.externalId,
      };
    }
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

/**
 * Violação de índice único no Prisma. Checagem por `code` em vez de
 * `instanceof PrismaClientKnownRequestError` para não acoplar ao cliente
 * gerado, que muda de caminho entre versões.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  );
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
