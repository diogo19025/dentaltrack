import { Logger } from '@nestjs/common';
import type {
  AvailableSlot,
  ExternalProfessional,
  ExternalStatus,
  ExternalUnit,
} from '@dentaltrack/shared';
import { toZonedParts, zonedDateKey, zonedTimeToUtc } from '../common/time';
import {
  type AgendaProvider,
  AgendaProviderError,
  AgendaSlotReleasedError,
  type AgendaWindow,
  type AvailabilityQuery,
  type CancelAppointmentInput,
  type CreateAppointmentInput,
  type CreatePatientInput,
  type ExternalAppointment,
  type ExternalPatient,
  type PatientQuery,
  type RescheduleAppointmentInput,
} from './agenda-provider';
import { CLINICORP_ROUTES, type ClinicorpClient } from './clinicorp.client';
import {
  readDateTime,
  readId,
  readList,
  readNumber,
  readString,
  toCompactDate,
} from './field-reader';

/** Duração padrão de um horário quando a agenda não informa o fim. */
const DEFAULT_SLOT_MINUTES = 30;

/** Conta (assinante) visível para a credencial — `GET /group/list_subscribers`. */
export interface ExternalSubscriber {
  /** `SubscriberBussinessUID` — o valor que as rotas esperam em `subscriber_id`. */
  id: string;
  /** `Namespace` — o id completo, só informativo. */
  namespace: string | null;
}

/**
 * Adapter do Clinicorp para a porta `AgendaProvider` (F9).
 *
 * Este é o **único** arquivo que conhece o formato do fornecedor. Os nomes de
 * parâmetro e de campo seguem o contrato publicado em
 * `https://api.clinicorp.com/api-docs/` (OpenAPI); a leitura continua passando
 * pelo `field-reader`, que aceita as grafias alternativas e desembrulha as
 * formas usuais de lista — de modo que uma divergência entre o que a
 * documentação diz e o que a API responde vira o ajuste de uma linha aqui.
 *
 * Particularidades do contrato que moldam este arquivo:
 * - `list_available_times` exige **profissional**; sem um padrão configurado, a
 *   consulta é feita para cada profissional da conta e os horários são unidos;
 * - a resposta dela é aninhada (`[{ date, slots: [{ fromTime, toTime }] }]`);
 * - `appointment/list` devolve `date` em UTC (meia-noite local) e a hora em
 *   `fromTime`/`toTime` **no fuso da clínica** — combinar os dois é o que evita
 *   errar o lembrete em três horas;
 * - `create_appointment_by_api` responde uma **lista** `[{ Status, id }]`;
 * - `patient/create` não documenta o id de retorno: quando ele não vem, o
 *   paciente é localizado de novo pelo telefone/nome.
 */
export class ClinicorpAgendaProvider implements AgendaProvider {
  readonly live = true;
  private readonly logger = new Logger(ClinicorpAgendaProvider.name);

  constructor(
    private readonly client: ClinicorpClient,
    private readonly timeZone: string,
    private readonly defaults: {
      unitId?: string | null;
      professionalId?: string | null;
    } = {},
  ) {}

  /**
   * Descobre o `subscriber_id` a partir da credencial. A rota não recebe
   * parâmetro nenhum — é a única que responde antes de a conta ser conhecida —
   * e por isso é o primeiro passo do smoke.
   */
  async listSubscribers(): Promise<ExternalSubscriber[]> {
    const payload = await this.client.get(CLINICORP_ROUTES.subscribers);
    const rows = readList(payload, 'subscribers');
    // A documentação descreve um objeto único; uma conta de grupo pode devolver
    // lista. As duas formas são aceitas.
    const candidates = rows.length ? rows : [payload];
    return candidates.flatMap((row) => {
      const id = readId(
        row,
        'SubscriberBussinessUID',
        'SubscriberBusinessUID',
        'subscriber_id',
        'id',
      );
      if (!id) return [];
      return [{ id, namespace: readString(row, 'Namespace') }];
    });
  }

  async listUnits(): Promise<ExternalUnit[]> {
    const payload = await this.client.get(CLINICORP_ROUTES.units);
    return readList(payload, 'business', 'clinics').flatMap((row) => {
      const id = readId(row, 'Clinic_BusinessId', 'BusinessId', 'id');
      if (!id) return [];
      return [
        {
          id,
          name:
            readString(
              row,
              'Name',
              'BusinessName',
              'ClinicName',
              'razaosocial',
            ) ?? `Unidade ${id}`,
        },
      ];
    });
  }

  /**
   * A rota não filtra por unidade (devolve todos os profissionais da conta) e
   * não informa a unidade de cada um; o parâmetro é aceito só para manter a
   * assinatura da porta.
   */
  async listProfessionals(
    _unitId?: string | null,
  ): Promise<ExternalProfessional[]> {
    const payload = await this.client.get(CLINICORP_ROUTES.professionals);
    return readList(payload, 'professionals', 'dentists').flatMap((row) => {
      const id = readId(row, 'Dentist_PersonId', 'PersonId', 'id');
      if (!id) return [];
      return [
        {
          id,
          name:
            readString(row, 'Name', 'PersonName', 'FullName') ??
            `Profissional ${id}`,
          unitId: readId(row, 'Clinic_BusinessId', 'BusinessId'),
        },
      ];
    });
  }

  /**
   * Status ativos da conta. O contrato traz `Active: "X"` — um status
   * desativado no painel não deve aparecer para o operador mapear.
   */
  async listStatuses(): Promise<ExternalStatus[]> {
    const payload = await this.client.get(CLINICORP_ROUTES.statuses);
    const rows = readList(payload, 'status', 'statuses');
    // A bandeira `Active` só é interpretada se a conta a usa (algum status a
    // traz): aí "vazio" é inativo. Numa resposta sem a bandeira, tudo entra.
    const usesActiveFlag = rows.some((row) =>
      isFlag(readString(row, 'Active')),
    );
    return rows.flatMap((row) => {
      const id = readId(row, 'Id', 'StatusId', 'Status_Id', 'code');
      const name = readString(
        row,
        'Description',
        'Name',
        'StatusName',
        'Status',
      );
      if (!id || !name) return [];
      if (usesActiveFlag && !isFlag(readString(row, 'Active'))) return [];
      return [{ id, name }];
    });
  }

  async listAvailableSlots(query: AvailabilityQuery): Promise<AvailableSlot[]> {
    const unitId = query.unitId ?? this.defaults.unitId ?? null;
    if (!unitId) {
      throw new AgendaProviderError(
        'Nenhuma unidade selecionada na integração — escolha a unidade em Configurações.',
        { kind: 'config' },
      );
    }

    // `professionalId` é obrigatório na rota. Sem um padrão, consulta-se cada
    // profissional da conta; escolher o padrão em Configurações evita o leque.
    const professionalId =
      query.professionalId ?? this.defaults.professionalId ?? null;
    const professionalIds = professionalId
      ? [professionalId]
      : (await this.listProfessionals(unitId)).map((p) => p.id);
    if (!professionalIds.length) {
      throw new AgendaProviderError(
        'A conta não devolveu nenhum profissional — a consulta de horários exige um.',
        { kind: 'config' },
      );
    }

    const fromDate = toCompactDate(query.from, this.timeZone);
    const toDate = toCompactDate(query.to, this.timeZone);
    const perProfessional = await Promise.all(
      professionalIds.map(async (id) => {
        const payload = await this.client.get(CLINICORP_ROUTES.availableTimes, {
          clinicId: unitId,
          professionalId: id,
          fromDate,
          toDate,
        });
        return expandSlotRows(payload).flatMap((row) =>
          this.toSlot(row, { unitId, professionalId: id, query }),
        );
      }),
    );

    const slots = perProfessional
      .flat()
      // A agenda pode devolver o dia inteiro, inclusive horas já passadas.
      .filter((slot) => new Date(slot.startsAt).getTime() > Date.now())
      .sort(
        (a, b) =>
          a.startsAt.localeCompare(b.startsAt) ||
          (a.professionalId ?? '').localeCompare(b.professionalId ?? ''),
      );

    return query.limit ? slots.slice(0, query.limit) : slots;
  }

  private toSlot(
    row: unknown,
    ctx: { unitId: string; professionalId: string; query: AvailabilityQuery },
  ): AvailableSlot[] {
    const startsAt = readDateTime(row, {
      dateKeys: ['date', 'day', 'slotTime', 'start', 'StartDateTime'],
      timeKeys: ['fromTime', 'from', 'time', 'StartTime', 'hour'],
      timeZone: this.timeZone,
    });
    if (!startsAt) return [];

    const endsAt =
      readDateTime(row, {
        dateKeys: ['date', 'day', 'slotTime', 'end', 'EndDateTime'],
        timeKeys: ['toTime', 'to', 'EndTime'],
        timeZone: this.timeZone,
      }) ??
      new Date(
        startsAt.getTime() +
          (ctx.query.durationMinutes ?? DEFAULT_SLOT_MINUTES) * 60_000,
      );

    return [
      {
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        professionalId:
          readId(row, 'Dentist_PersonId', 'PersonId') ?? ctx.professionalId,
        professionalName: readString(row, 'DentistName', 'Name'),
        unitId: readId(row, 'Clinic_BusinessId', 'BusinessId') ?? ctx.unitId,
      } satisfies AvailableSlot,
    ];
  }

  /**
   * Agenda do período. Desmarcados **e excluídos** entram de propósito: é assim
   * que a sincronização descobre que a recepção desmarcou uma consulta criada
   * pelo bot e derruba o lembrete. Visto ao vivo (2026-09-17): o
   * `cancel_appointment` marca o agendamento com `Canceled: X` **e**
   * `Deleted: X`, e ele só volta na listagem com os dois filtros — sem
   * `includeDeleted` o cancelamento simplesmente sumiria da varredura.
   */
  async listAppointments(query: AgendaWindow): Promise<ExternalAppointment[]> {
    const unitId = query.unitId ?? this.defaults.unitId ?? null;
    const payload = await this.client.get(CLINICORP_ROUTES.appointments, {
      from: zonedDateKey(query.from, this.timeZone),
      to: zonedDateKey(query.to, this.timeZone),
      businessId: unitId ?? undefined,
      includeCanceled: 'X',
      includeDeleted: 'X',
    });
    return readList(payload, 'appointments', 'schedule').flatMap((row) => {
      const itemType = readString(row, 'ItemType');
      if (itemType && itemType.toUpperCase() !== 'APPOINTMENT') return [];
      const parsed = this.toAppointment(row);
      return parsed ? [parsed] : [];
    });
  }

  /**
   * `patient/get` busca **um** paciente pelos filtros nomeados e responde um
   * objeto (ou 404 quando não há). Telefone é o filtro mais confiável — a rota
   * aceita qualquer formato, com ou sem DDI.
   */
  async findPatient(query: PatientQuery): Promise<ExternalPatient | null> {
    const filters = {
      Phone: query.phone?.trim() || undefined,
      Email: query.email?.trim() || undefined,
      Name: query.name?.trim() || undefined,
    };
    if (!filters.Phone && !filters.Email && !filters.Name) return null;

    let payload: unknown;
    try {
      payload = await this.client.get(CLINICORP_ROUTES.patientSearch, filters);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }

    const rows = readList(payload, 'patients', 'patient');
    // Resposta de registro único também é aceita (objeto solto em vez de lista).
    const row =
      rows[0] ??
      (readId(payload, 'PatientId', 'Patient_PersonId', 'PersonId', 'id')
        ? payload
        : null);
    if (!row) return null;

    const id = readId(row, 'PatientId', 'Patient_PersonId', 'PersonId', 'id');
    if (!id) return null;
    return {
      id,
      name: readString(row, 'Name', 'PatientName', 'FullName'),
      phone: readString(row, 'Phone', 'MobilePhone', 'CellPhone', 'Mobile'),
      email: readString(row, 'Email'),
    };
  }

  /**
   * Cria o paciente. O contrato não documenta o id na resposta; quando ele não
   * vem, o paciente recém-criado é localizado pelo telefone (ou pelo nome) —
   * sem id não há como vincular o agendamento a ele.
   *
   * **Nome repetido** (visto ao vivo em 2026-09-17): a rota recusa com 400 e
   * pede `IgnoreSameName: "X"` para criar mesmo assim. Com telefone, cria-se
   * mesmo assim — telefone diferente é outra pessoa, e vincular a consulta ao
   * homônimo seria errar de paciente. Sem telefone não há como distinguir, e o
   * homônimo existente é reaproveitado.
   */
  async createPatient(input: CreatePatientInput): Promise<ExternalPatient> {
    const body = {
      Name: input.name,
      MobilePhone: input.phone ?? undefined,
      Email: input.email ?? undefined,
    };
    let payload: unknown;
    try {
      payload = await this.client.post(CLINICORP_ROUTES.patientCreate, body);
    } catch (err) {
      if (!isSameNameRefusal(err)) throw err;
      if (input.phone) {
        payload = await this.client.post(CLINICORP_ROUTES.patientCreate, {
          ...body,
          IgnoreSameName: 'X',
        });
      } else {
        const existing = await this.findPatient({ name: input.name });
        if (!existing) throw err;
        this.logger.warn(
          `Paciente "${input.name}" já existia no Clinicorp (sem telefone para distinguir) — reaproveitado: ${existing.id}.`,
        );
        return existing;
      }
    }

    const id =
      readId(payload, 'PatientId', 'Patient_PersonId', 'PersonId', 'id') ??
      (
        await this.findPatient(
          input.phone ? { phone: input.phone } : { name: input.name },
        )
      )?.id ??
      null;
    if (!id) {
      throw new AgendaProviderError(
        `O Clinicorp aceitou a criação do paciente mas não devolveu o identificador (${describeResult(payload)}).`,
        { kind: 'resposta_invalida' },
      );
    }
    return {
      id,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
    };
  }

  async createAppointment(
    input: CreateAppointmentInput,
  ): Promise<ExternalAppointment> {
    const payload = await this.client.post(CLINICORP_ROUTES.createAppointment, {
      PatientName: input.patientName,
      Patient_PersonId: input.patientId ?? undefined,
      MobilePhone: input.patientPhone ?? undefined,
      Email: input.patientEmail ?? undefined,
      // `date` é ISO 8601 apontando para a meia-noite do dia **no fuso da
      // clínica** (o exemplo do contrato é "2025-04-12T03:00:00.000Z"); a hora
      // vai separada, em HH:mm local.
      date: localMidnight(input.startsAt, this.timeZone).toISOString(),
      fromTime: formatClock(input.startsAt, this.timeZone),
      toTime: formatClock(input.endsAt, this.timeZone),
      Clinic_BusinessId: input.unitId,
      Dentist_PersonId: input.professionalId || undefined,
      Procedures: input.procedureName ?? undefined,
      Notes: input.notes ?? undefined,
    });

    // A resposta é uma lista: `[{ Status: "CREATED", id }]`.
    const result = firstRow(payload);
    const externalId = readId(
      result,
      'id',
      'AppointmentId',
      'Appointment_Id',
      'ScheduleId',
    );
    const status = readString(result, 'Status');

    // Há evidência real de HTTP 200 sem agendamento criado (o caso conhecido é
    // "PatientNameAlreadyExists"). Sucesso de transporte não é sucesso de
    // agendamento: sem id, isto é falha — e falhar aqui é o que impede o bot de
    // dizer "está marcado!" para um horário que não existe.
    if (!externalId || (status && status.toUpperCase() !== 'CREATED')) {
      throw new AgendaProviderError(
        `O Clinicorp respondeu sem criar o agendamento (${describeResult(result ?? payload)}).`,
        { kind: 'resposta_invalida' },
      );
    }

    this.logger.log(`Agendamento criado no Clinicorp: ${externalId}`);
    return {
      externalId,
      patientExternalId: input.patientId,
      patientName: input.patientName,
      patientPhone: input.patientPhone ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      professionalExternalId: input.professionalId,
      professionalName: null,
      unitExternalId: input.unitId,
      statusExternalId: null,
      statusName: null,
      procedureName: input.procedureName ?? null,
    };
  }

  /**
   * Cancela pela rota `cancel_appointment` (`{ subscriber_id, id }`). Um 404 do
   * fornecedor ("não existe") conta como cancelado: é o estado final que se
   * queria, e repetir a operação não pode virar erro.
   */
  async cancelAppointment(input: CancelAppointmentInput): Promise<void> {
    try {
      await this.client.post(CLINICORP_ROUTES.cancelAppointment, {
        id: input.externalId,
      });
    } catch (err) {
      if (isNotFound(err)) {
        this.logger.warn(
          `Agendamento ${input.externalId} já não existe no Clinicorp — tratado como cancelado.`,
        );
        return;
      }
      throw err;
    }
    this.logger.log(`Agendamento cancelado no Clinicorp: ${input.externalId}`);
  }

  /**
   * O contrato **não expõe reagendamento**: remarcar é cancelar e recriar, e o
   * id externo muda — por isso a porta devolve o agendamento inteiro. Se o
   * cancelamento passar e a criação falhar, o horário antigo já foi liberado e
   * o novo não existe: o erro sobe com essa informação para o chamador não
   * confirmar nada ao cliente. Limite documentado em docs/operacao.md.
   */
  async rescheduleAppointment(
    input: RescheduleAppointmentInput,
  ): Promise<ExternalAppointment> {
    await this.cancelAppointment({
      externalId: input.externalId,
      unitId: input.unitId,
    });
    try {
      return await this.createAppointment(input);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Tipo próprio (P0.1): o chamador precisa saber que o horário antigo já
      // não está mais reservado, para não deixar a linha local afirmando o
      // contrário. Uma mensagem de erro genérica aqui deixava a divergência
      // visível só para quem lesse o log.
      throw new AgendaSlotReleasedError(
        `O horário anterior foi cancelado no Clinicorp, mas o novo não pôde ser criado: ${detail}`,
        err,
      );
    }
  }

  /** Linha da agenda → agendamento normalizado. `null` se faltar o essencial. */
  private toAppointment(row: unknown): ExternalAppointment | null {
    const externalId = readId(
      row,
      'id',
      'AppointmentId',
      'Appointment_Id',
      'ScheduleId',
    );
    // `AtomicDate` (AAAAMMDD) é a data local pura; `date` é um instante UTC que
    // o field-reader converte para o dia local antes de somar `fromTime`.
    const startsAt = readDateTime(row, {
      dateKeys: ['AtomicDate', 'date', 'StartDateTime', 'day'],
      timeKeys: ['fromTime', 'from', 'StartTime', 'hour'],
      timeZone: this.timeZone,
    });
    if (!externalId || !startsAt) return null;

    const endsAt =
      readDateTime(row, {
        dateKeys: ['AtomicDate', 'date', 'EndDateTime', 'day'],
        timeKeys: ['toTime', 'to', 'EndTime'],
        timeZone: this.timeZone,
      }) ??
      new Date(
        startsAt.getTime() +
          (readNumber(row, 'duration', 'DurationMinutes') ??
            DEFAULT_SLOT_MINUTES) *
            60_000,
      );

    // Desmarcado é uma **bandeira** (`Canceled: "X"`, e `Deleted: "X"` quando
    // excluído da agenda), não um status: o agendamento continua com o
    // StatusId que tinha antes. Se esse id fosse traduzido, o mapeamento do
    // operador ganharia e a desmarcação se perderia — por isso a bandeira vira
    // o nome "Desmarcado" sem id, que a heurística reconhece como `cancelado`.
    const canceled =
      isFlag(readString(row, 'Canceled')) || isFlag(readString(row, 'Deleted'));

    return {
      externalId,
      patientExternalId: readId(row, 'Patient_PersonId', 'PersonId'),
      patientName: readString(row, 'PatientName', 'Patient', 'Name'),
      patientPhone: readString(
        row,
        'MobilePhone',
        'Phone',
        'CellPhone',
        'Mobile',
      ),
      startsAt,
      endsAt,
      professionalExternalId: readId(row, 'Dentist_PersonId', 'PersonId'),
      professionalName: readString(row, 'DentistName', 'Professional'),
      unitExternalId: readId(row, 'Clinic_BusinessId', 'BusinessId'),
      statusExternalId: canceled
        ? null
        : readId(row, 'StatusId', 'Status_Id', 'Status'),
      statusName: canceled
        ? 'Desmarcado'
        : readString(
            row,
            'StatusName',
            'StatusDescription',
            'Status',
            'Situation',
          ),
      procedureName: readString(
        row,
        'Procedures',
        'ProcedureName',
        'Procedure',
        'Category',
      ),
    };
  }
}

/**
 * `list_available_times` responde por dia: `[{ date, slots: [{ fromTime,
 * toTime }] }]`. Cada slot vira uma linha própria com a data do dia — e uma
 * resposta já plana (slot com a própria data) passa intocada.
 */
function expandSlotRows(payload: unknown): Record<string, unknown>[] {
  return readList(
    payload,
    'days',
    'times',
    'available_times',
    'schedule',
  ).flatMap((row) => {
    const slots = readList(row, 'slots');
    if (!slots.length) return [row];
    const date = readString(row, 'date', 'day');
    return slots.map((slot) => ({ date, ...slot }));
  });
}

/** Primeiro registro de uma resposta em lista; objeto solto passa direto. */
function firstRow(payload: unknown): unknown {
  return Array.isArray(payload) ? payload[0] : payload;
}

/** 400 de `patient/create` por nome repetido — pede `IgnoreSameName`. */
function isSameNameRefusal(err: unknown): boolean {
  return (
    err instanceof AgendaProviderError &&
    err.status === 400 &&
    /IgnoreSameName|mesmo nome/i.test(err.message)
  );
}

/** As bandeiras do Clinicorp são a letra "X" (maiúscula ou minúscula). */
function isFlag(value: string | null): boolean {
  return value?.trim().toUpperCase() === 'X';
}

/**
 * "Não existe lá" — o sinal de que um cancelamento já aconteceu.
 *
 * Lê o `status` que o client passou a guardar (P0.1) em vez de procurar
 * "respondeu 404" no texto da mensagem: qualquer ajuste de redação naquela
 * string quebrava a idempotência do cancelamento sem quebrar nenhum teste.
 */
function isNotFound(err: unknown): boolean {
  return err instanceof AgendaProviderError && err.status === 404;
}

/** "HH:mm" no fuso da empresa (formato que a criação de agendamento espera). */
function formatClock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Meia-noite, no fuso da empresa, do dia em que o instante cai. */
function localMidnight(date: Date, timeZone: string): Date {
  const p = toZonedParts(date, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/**
 * Resume o corpo de uma resposta sem id para a mensagem de erro. É o que
 * transforma "não deu certo" em "PatientNameAlreadyExists" na tela do operador.
 */
function describeResult(payload: unknown): string {
  const result =
    readString(
      payload,
      'Result',
      'result',
      'message',
      'Message',
      'error',
      'Status',
    ) ?? null;
  if (result) return result;
  try {
    return JSON.stringify(payload).slice(0, 200);
  } catch {
    return 'resposta ilegível';
  }
}
