import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  AgendaErrorKind,
  AgendaQuery,
  AgendaResponse,
  AppointmentSummary,
  Availability,
} from '@dentaltrack/shared';
import { dateKeyToUtc, DEFAULT_TIMEZONE } from '../common/time';
import {
  agendaErrorKind,
  AgendaSlotReleasedError,
  type AgendaProvider,
} from '../clinicorp/agenda-provider';
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
  /**
   * **Por que** o horário não foi reservado — `null` quando foi (P0.1).
   *
   * Substituiu o booleano `conflict` do P0.5: a distinção que importa não é
   * "houve conflito ou não", é o motivo, porque cada um pede uma conduta
   * diferente do agente. `conflito` (a re-checagem viu o horário ocupado) manda
   * oferecer outro horário; o resto manda prometer o retorno da equipe. Um
   * segundo campo booleano ao lado da categoria seria a mesma informação
   * contada duas vezes, com uma chance de discordarem.
   */
  failureKind: AgendaErrorKind | null;
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
        failureKind: null,
      };
    }

    // 2. Agenda real da empresa.
    const provider = await this.integrations.getProvider(clinicId);
    let externalId: string | null = null;
    let professionalName: string | null = null;
    let confirmed = false;
    let failureKind: AgendaErrorKind | null = null;

    if (provider && input.startsAt && input.patientName) {
      try {
        const startsAt = input.startsAt;
        const endsAt = new Date(startsAt.getTime() + duration * 60_000);
        const unitId =
          input.unitId ?? (await this.defaultUnitId(clinicId, provider));
        const professionalId =
          input.professionalId ??
          (await this.defaultProfessionalId(clinicId, provider));

        // Entre a oferta do horário e a escolha do cliente passam minutos; a
        // re-checagem estreita essa janela. Ela não a elimina — nenhum dos
        // provedores oferece reserva atômica —, e por isso é fail-open: só é
        // conflito quando a agenda respondeu e o horário sumiu da lista.
        if (
          await this.slotTaken(provider, {
            startsAt,
            endsAt,
            unitId,
            professionalId,
            durationMinutes: duration,
          })
        ) {
          throw new SlotConflictError(startsAt);
        }

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
          startsAt,
          endsAt,
          unitId,
          professionalId,
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
        if (err instanceof SlotConflictError) {
          // O horário deixou de existir: a linha local não pode continuar
          // `agendado` (lembrete sairia para uma consulta que não há). Vira
          // `pedido`, com o horário desejado guardado, e o agente oferece outro.
          failureKind = 'conflito';
          await this.prisma.appointment.update({
            where: { id: local.id },
            data: { status: PEDIDO },
          });
          this.logger.warn(
            `Horário ${input.startsAt.toISOString()} já ocupado na agenda da empresa ${clinicId}; pedido ${local.id} mantido sem reserva.`,
          );
        } else {
          // O pedido já está registrado (passo 1): perder o interesse do
          // cliente por uma falha de integração seria pior. `confirmed` fica
          // false e o agente promete retorno em vez de confirmar.
          failureKind = agendaErrorKind(err);
          this.logger.error(
            `Falha ao gravar o agendamento na agenda da empresa ${clinicId}: ${detail}`,
            err instanceof Error ? err.stack : undefined,
          );
        }
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
      ...(failureKind ? { reason: failureKind } : {}),
    });

    return {
      appointmentId: local.id,
      startsAt: input.startsAt,
      confirmed,
      externalId,
      failureKind,
    };
  }

  /**
   * Cancela o agendamento (P0.5) — na agenda real primeiro, depois aqui.
   *
   * A ordem é a inversa do `book()` de propósito: lá o registro local é o que
   * não pode se perder; aqui o que não pode acontecer é a agenda da empresa
   * continuar ocupada com um horário que o DentalTrack diz estar livre. Se a
   * agenda recusar, nada muda localmente e o erro sobe para a tela.
   *
   * **Idempotente por transição:** cancelar o que já está cancelado devolve o
   * agendamento como está, sem tocar no provedor — repetição não é erro.
   * Lembretes pendentes morrem sozinhos: a revalidação na hora do envio já
   * suprime o que aponta para agendamento `cancelado`.
   */
  async cancel(clinicId: string, id: string): Promise<AppointmentSummary> {
    const row = await this.requireAppointment(clinicId, id);
    if (row.status === 'cancelado') {
      this.logger.log({
        event: 'agenda.cancel',
        outcome: 'ok',
        appointmentId: id,
        reaproveitado: true,
      });
      return this.summaryOf(clinicId, id);
    }

    await this.withProvider(
      clinicId,
      row.externalId,
      'cancelar',
      null,
      (provider) =>
        provider.cancelAppointment({
          externalId: row.externalId as string,
          unitId: row.unitExternalId,
        }),
    );

    await this.prisma.appointment.update({
      where: { id },
      data: { status: 'cancelado', canceledAt: new Date() },
    });
    this.logger.log({
      event: 'agenda.cancel',
      outcome: 'ok',
      appointmentId: id,
      integracao: row.externalId !== null,
    });
    return this.summaryOf(clinicId, id);
  }

  /**
   * Move o agendamento para outro horário (P0.5). Mesmo desenho do `cancel()`:
   * agenda real primeiro; se ela recusar, o horário antigo continua valendo.
   *
   * Remarcar para o **mesmo** horário é no-op de sucesso. O status volta a
   * `agendado` (uma confirmação era do horário antigo; uma falta, idem), e os
   * lembretes se ajustam sozinhos — a chave deles carrega o horário, então o
   * planejador enfileira os novos e a revalidação suprime os velhos.
   *
   * Não há re-checagem de disponibilidade aqui: quem remarca é a equipe, pela
   * tela, com horários que não vêm da grade do provedor — e a autoridade final
   * sobre o horário é a agenda dele.
   */
  async reschedule(
    clinicId: string,
    id: string,
    startsAt: Date,
  ): Promise<AppointmentSummary> {
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Horário inválido.');
    }
    if (startsAt.getTime() < Date.now() - 60_000) {
      throw new BadRequestException('O novo horário já passou.');
    }
    const row = await this.requireAppointment(clinicId, id);
    if (row.status === 'cancelado' || row.status === 'compareceu') {
      throw new BadRequestException(
        'Só agendamentos ainda de pé podem ser remarcados.',
      );
    }
    if (row.startsAt && row.startsAt.getTime() === startsAt.getTime()) {
      this.logger.log({
        event: 'agenda.reschedule',
        outcome: 'ok',
        appointmentId: id,
        reaproveitado: true,
      });
      return this.summaryOf(clinicId, id);
    }

    const duration =
      row.startsAt && row.endsAt
        ? Math.max(
            1,
            Math.round(
              (row.endsAt.getTime() - row.startsAt.getTime()) / 60_000,
            ),
          )
        : (row.procedure?.durationMinutes ?? DEFAULT_DURATION_MINUTES);
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);

    let externalId = row.externalId;
    let professionalName = row.professionalName;
    await this.withProvider(
      clinicId,
      row.externalId,
      'remarcar',
      // Adapter que remarca cancelando e recriando (Clinicorp) pode falhar com
      // o horário antigo já liberado. A operação falha de qualquer jeito, mas a
      // linha local não pode continuar afirmando um agendamento que não existe
      // mais em lugar nenhum — senão o lembrete sai para uma consulta fantasma.
      (err) => this.recordReleasedSlot(err, clinicId, id, startsAt, endsAt),
      async (provider) => {
        const moved = await provider.rescheduleAppointment({
          externalId: row.externalId as string,
          patientId: row.lead?.externalId ?? null,
          patientName: row.lead?.name ?? 'Cliente',
          patientPhone: row.lead?.phone ?? null,
          startsAt,
          endsAt,
          unitId:
            row.unitExternalId ??
            (await this.defaultUnitId(clinicId, provider)),
          professionalId:
            row.professionalExternalId ??
            (await this.defaultProfessionalId(clinicId, provider)),
          procedureName: row.procedure?.name ?? row.notes,
        });
        externalId = moved.externalId;
        professionalName = moved.professionalName ?? professionalName;
      },
    );

    await this.prisma.appointment.update({
      where: { id },
      data: {
        startsAt,
        endsAt,
        externalId,
        professionalName,
        status: AGENDADO,
        canceledAt: null,
      },
    });
    this.logger.log({
      event: 'agenda.reschedule',
      outcome: 'ok',
      appointmentId: id,
      integracao: row.externalId !== null,
      externalIdMudou: externalId !== row.externalId,
    });
    return this.summaryOf(clinicId, id);
  }

  /**
   * Executa a operação na agenda real quando há o que executar — o
   * agendamento tem id externo **e** a integração está ligada. Integração
   * desligada depois do agendamento: opera só aqui e avisa no log. Falha do
   * provedor vira 503 com a mensagem dele, e nada local muda.
   */
  private async withProvider(
    clinicId: string,
    externalId: string | null,
    action: 'cancelar' | 'remarcar',
    /**
     * Chance de registrar localmente o que a falha deixou para trás, antes de
     * ela virar 503. Sem este gancho, o `catch` não teria como distinguir uma
     * recusa (nada mudou lá) de uma falha no meio do caminho (algo mudou).
     */
    onFailure: ((err: unknown) => Promise<void>) | null,
    run: (provider: AgendaProvider) => Promise<void>,
  ): Promise<void> {
    if (!externalId) return;
    const provider = await this.integrations.getProvider(clinicId);
    if (!provider) {
      this.logger.warn(
        `Agendamento ${externalId} tem id externo mas a integração da empresa ${clinicId} está desligada — ${action} só no DentalTrack.`,
      );
      return;
    }
    try {
      await run(provider);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Não foi possível ${action} o agendamento ${externalId} na agenda da empresa ${clinicId}: ${detail}`,
        err instanceof Error ? err.stack : undefined,
      );
      await onFailure?.(err);
      throw new ServiceUnavailableException(
        `A agenda da empresa não aceitou ${action} agora: ${detail}`,
      );
    }
  }

  /**
   * A remarcação falhou **depois** de liberar o horário antigo: registra a
   * verdade em vez de deixar a linha mentindo (P0.1).
   *
   * O estado honesto é o mesmo do conflito no `book()` — `pedido`, com o
   * horário desejado guardado e sem id externo: o cliente quer aquele horário,
   * nada está reservado em lugar nenhum. E `pedido` fica fora do filtro do
   * planejador de lembretes (`agendado`/`confirmado`), então nenhuma mensagem
   * sai prometendo uma consulta que a agenda da empresa não tem.
   *
   * Falhar aqui não pode piorar nada: o erro original já está a caminho da
   * tela, e engoli-lo com um log é melhor do que trocá-lo por outro.
   */
  private async recordReleasedSlot(
    err: unknown,
    clinicId: string,
    id: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<void> {
    if (!(err instanceof AgendaSlotReleasedError)) return;
    try {
      await this.prisma.appointment.update({
        where: { id },
        data: { status: PEDIDO, startsAt, endsAt, externalId: null },
      });
      this.logger.warn({
        event: 'agenda.reschedule',
        outcome: 'fail',
        appointmentId: id,
        reason: 'horario_liberado',
      });
    } catch (updateErr) {
      const detail =
        updateErr instanceof Error ? updateErr.message : String(updateErr);
      this.logger.error(
        `Agendamento ${id} da empresa ${clinicId} perdeu a reserva externa e não pôde ser rebaixado para pedido: ${detail}`,
      );
    }
  }

  /**
   * Re-checagem de disponibilidade antes de gravar (P0.5). **Fail-open
   * deliberado:** erro na consulta ou lista vazia → `false` (segue e cria),
   * porque a autoridade final é o provedor e uma consulta que falhou não é
   * evidência de conflito. Só é conflito quando a agenda respondeu com
   * horários e o pedido não está entre eles.
   */
  private async slotTaken(
    provider: AgendaProvider,
    slot: {
      startsAt: Date;
      endsAt: Date;
      unitId: string;
      professionalId: string;
      durationMinutes: number;
    },
  ): Promise<boolean> {
    try {
      const free = await provider.listAvailableSlots({
        from: slot.startsAt,
        to: slot.endsAt,
        unitId: slot.unitId,
        professionalId: slot.professionalId,
        durationMinutes: slot.durationMinutes,
      });
      if (free.length === 0) return false;
      const wanted = slot.startsAt.getTime();
      return !free.some((s) => new Date(s.startsAt).getTime() === wanted);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Re-checagem de disponibilidade falhou (${detail}); seguindo — a agenda decide.`,
      );
      return false;
    }
  }

  /** O agendamento existe e é desta empresa? 404 cross-tenant. */
  private async requireAppointment(clinicId: string, id: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id, clinicId },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        externalId: true,
        unitExternalId: true,
        professionalExternalId: true,
        professionalName: true,
        notes: true,
        procedure: { select: { name: true, durationMinutes: true } },
        lead: { select: { name: true, phone: true, externalId: true } },
      },
    });
    if (!row) throw new NotFoundException('Agendamento não encontrado.');
    return row;
  }

  /** Projeção de um agendamento para a tela, depois de uma mutação. */
  private async summaryOf(
    clinicId: string,
    id: string,
  ): Promise<AppointmentSummary> {
    const row = await this.prisma.appointment.findFirst({
      where: { id, clinicId },
      select: SUMMARY_SELECT,
    });
    if (!row) throw new NotFoundException('Agendamento não encontrado.');
    return toSummary(row);
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
      select: SUMMARY_SELECT,
    });

    const integration = await this.integrations.activeStatus(clinicId);

    return {
      lastSyncedAt: integration.lastSyncedAt,
      appointments: rows.map(toSummary),
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

/** Projeção comum de um agendamento para o formato que a UI consome. */
const SUMMARY_SELECT = {
  id: true,
  status: true,
  source: true,
  startsAt: true,
  endsAt: true,
  preferredTime: true,
  professionalName: true,
  externalId: true,
  canceledAt: true,
  createdAt: true,
  conversationId: true,
  leadId: true,
  procedure: { select: { name: true } },
  notes: true,
  lead: { select: { name: true, phone: true } },
} as const;

interface SummaryRow {
  id: string;
  status: AppointmentSummary['status'];
  source: AppointmentSummary['source'];
  startsAt: Date | null;
  endsAt: Date | null;
  preferredTime: string | null;
  professionalName: string | null;
  externalId: string | null;
  canceledAt: Date | null;
  createdAt: Date;
  conversationId: string | null;
  leadId: string | null;
  procedure: { name: string } | null;
  notes: string | null;
  lead: { name: string | null; phone: string | null } | null;
}

function toSummary(row: SummaryRow): AppointmentSummary {
  return {
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
    canceledAt: row.canceledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A re-checagem viu o horário ocupado antes da escrita (P0.5). */
class SlotConflictError extends Error {
  constructor(readonly startsAt: Date) {
    super(`Horário ${startsAt.toISOString()} já ocupado na agenda.`);
    this.name = 'SlotConflictError';
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
