import { Logger } from '@nestjs/common';
import type {
  AvailableSlot,
  ExternalProfessional,
  ExternalStatus,
  ExternalUnit,
} from '@dentaltrack/shared';
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

/**
 * Adapter do Clinicorp para a porta `AgendaProvider` (F9).
 *
 * Este é o **único** arquivo que conhece o formato do fornecedor. Toda leitura
 * passa pelo `field-reader`, que tenta as grafias plausíveis de cada campo —
 * de modo que uma divergência entre o contrato observado e o real vira o ajuste
 * de uma linha aqui, e não uma revisão das automações que consomem a agenda.
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

  async listProfessionals(
    unitId?: string | null,
  ): Promise<ExternalProfessional[]> {
    const payload = await this.client.get(CLINICORP_ROUTES.professionals, {
      Clinic_BusinessId: unitId ?? this.defaults.unitId ?? undefined,
    });
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

  async listStatuses(): Promise<ExternalStatus[]> {
    const payload = await this.client.get(CLINICORP_ROUTES.statuses);
    return readList(payload, 'status', 'statuses').flatMap((row) => {
      const id = readId(row, 'Id', 'StatusId', 'Status_Id', 'code');
      const name = readString(
        row,
        'Name',
        'Description',
        'StatusName',
        'Status',
      );
      if (!id || !name) return [];
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
    const professionalId =
      query.professionalId ?? this.defaults.professionalId ?? null;

    const payload = await this.client.get(CLINICORP_ROUTES.availableTimes, {
      Clinic_BusinessId: unitId,
      Dentist_PersonId: professionalId ?? undefined,
      // A rota espera as datas no formato compacto AAAAMMDD.
      date_from: toCompactDate(query.from, this.timeZone),
      date_to: toCompactDate(query.to, this.timeZone),
      duration: query.durationMinutes ?? undefined,
    });

    const slots = readList(payload, 'times', 'available_times', 'schedule')
      .flatMap((row) => {
        const startsAt = readDateTime(row, {
          dateKeys: ['date', 'Date', 'day', 'start', 'StartDateTime'],
          timeKeys: ['fromTime', 'from', 'time', 'StartTime', 'hour'],
          timeZone: this.timeZone,
        });
        if (!startsAt) return [];

        const endsAt =
          readDateTime(row, {
            dateKeys: ['date', 'Date', 'day', 'end', 'EndDateTime'],
            timeKeys: ['toTime', 'to', 'EndTime'],
            timeZone: this.timeZone,
          }) ??
          new Date(
            startsAt.getTime() +
              (query.durationMinutes ?? DEFAULT_SLOT_MINUTES) * 60_000,
          );

        return [
          {
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            professionalId:
              readId(row, 'Dentist_PersonId', 'PersonId') ?? professionalId,
            professionalName: readString(row, 'DentistName', 'Name'),
            unitId: readId(row, 'Clinic_BusinessId', 'BusinessId') ?? unitId,
          } satisfies AvailableSlot,
        ];
      })
      // A agenda pode devolver o dia inteiro, inclusive horas já passadas.
      .filter((slot) => new Date(slot.startsAt).getTime() > Date.now())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    return query.limit ? slots.slice(0, query.limit) : slots;
  }

  async listAppointments(query: AgendaWindow): Promise<ExternalAppointment[]> {
    const unitId = query.unitId ?? this.defaults.unitId ?? null;
    const payload = await this.client.get(CLINICORP_ROUTES.appointments, {
      Clinic_BusinessId: unitId ?? undefined,
      date_from: toCompactDate(query.from, this.timeZone),
      date_to: toCompactDate(query.to, this.timeZone),
    });
    return readList(payload, 'appointments', 'schedule').flatMap((row) => {
      const parsed = this.toAppointment(row);
      return parsed ? [parsed] : [];
    });
  }

  async findPatient(query: PatientQuery): Promise<ExternalPatient | null> {
    const term =
      query.phone?.trim() || query.email?.trim() || query.name?.trim();
    if (!term) return null;

    const payload = await this.client.get(CLINICORP_ROUTES.patientSearch, {
      // A rota de busca aceita termo livre; mandamos também os campos nomeados
      // porque contas diferentes aceitam filtros diferentes.
      search: term,
      phone: query.phone ?? undefined,
      email: query.email ?? undefined,
      name: query.name ?? undefined,
    });

    const rows = readList(payload, 'patients', 'patient');
    // Resposta de registro único também é aceita (objeto solto em vez de lista).
    const row =
      rows[0] ??
      (readId(payload, 'Patient_PersonId', 'PersonId') ? payload : null);
    if (!row) return null;

    const id = readId(row, 'Patient_PersonId', 'PersonId', 'id');
    if (!id) return null;
    return {
      id,
      name: readString(row, 'Name', 'PatientName', 'FullName'),
      phone: readString(row, 'Phone', 'CellPhone', 'Mobile', 'telefone'),
      email: readString(row, 'Email', 'email'),
    };
  }

  async createPatient(input: CreatePatientInput): Promise<ExternalPatient> {
    const payload = await this.client.post(CLINICORP_ROUTES.patientCreate, {
      Name: input.name,
      Phone: input.phone ?? undefined,
      Email: input.email ?? undefined,
    });

    const id = readId(payload, 'Patient_PersonId', 'PersonId', 'id');
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
      Phone: input.patientPhone ?? undefined,
      Email: input.patientEmail ?? undefined,
      date: toCompactDate(input.startsAt, this.timeZone),
      fromTime: formatClock(input.startsAt, this.timeZone),
      toTime: formatClock(input.endsAt, this.timeZone),
      Clinic_BusinessId: input.unitId,
      Dentist_PersonId: input.professionalId,
      Notes: input.notes ?? undefined,
    });

    const externalId = readId(
      payload,
      'AppointmentId',
      'Appointment_Id',
      'ScheduleId',
      'id',
    );

    // Há evidência real de HTTP 200 sem agendamento criado (o caso conhecido é
    // "PatientNameAlreadyExists"). Sucesso de transporte não é sucesso de
    // agendamento: sem id, isto é falha — e falhar aqui é o que impede o bot de
    // dizer "está marcado!" para um horário que não existe.
    if (!externalId) {
      throw new AgendaProviderError(
        `O Clinicorp respondeu sem criar o agendamento (${describeResult(payload)}).`,
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
   * Cancela pela rota `cancel_appointment` — declarada no inventário desde a
   * F9 e nunca chamada até o P0.5. Um 404 do fornecedor ("não existe") conta
   * como cancelado: é o estado final que se queria, e repetir a operação não
   * pode virar erro.
   */
  async cancelAppointment(input: CancelAppointmentInput): Promise<void> {
    try {
      await this.client.post(CLINICORP_ROUTES.cancelAppointment, {
        AppointmentId: input.externalId,
        Clinic_BusinessId: input.unitId ?? this.defaults.unitId ?? undefined,
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
   * O inventário da API **não expõe reagendamento**: remarcar é cancelar e
   * recriar, e o id externo muda — por isso a porta devolve o agendamento
   * inteiro. Se o cancelamento passar e a criação falhar, o horário antigo já
   * foi liberado e o novo não existe: o erro sobe com essa informação para o
   * chamador não confirmar nada ao cliente. Limite documentado em
   * docs/CLINICORP.md.
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
      'AppointmentId',
      'Appointment_Id',
      'ScheduleId',
      'id',
    );
    const startsAt = readDateTime(row, {
      dateKeys: ['date', 'Date', 'StartDateTime', 'day'],
      timeKeys: ['fromTime', 'from', 'StartTime', 'hour'],
      timeZone: this.timeZone,
    });
    if (!externalId || !startsAt) return null;

    const endsAt =
      readDateTime(row, {
        dateKeys: ['date', 'Date', 'EndDateTime', 'day'],
        timeKeys: ['toTime', 'to', 'EndTime'],
        timeZone: this.timeZone,
      }) ??
      new Date(
        startsAt.getTime() +
          (readNumber(row, 'duration', 'DurationMinutes') ??
            DEFAULT_SLOT_MINUTES) *
            60_000,
      );

    return {
      externalId,
      patientExternalId: readId(row, 'Patient_PersonId', 'PersonId'),
      patientName: readString(row, 'PatientName', 'Patient', 'Name'),
      patientPhone: readString(row, 'Phone', 'CellPhone', 'Mobile'),
      startsAt,
      endsAt,
      professionalExternalId: readId(row, 'Dentist_PersonId', 'PersonId'),
      professionalName: readString(row, 'DentistName', 'Professional'),
      unitExternalId: readId(row, 'Clinic_BusinessId', 'BusinessId'),
      statusExternalId: readId(row, 'StatusId', 'Status_Id', 'Status'),
      statusName: readString(row, 'StatusName', 'Status', 'Situation'),
      procedureName: readString(row, 'ProcedureName', 'Procedure', 'Category'),
    };
  }
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

/**
 * Resume o corpo de uma resposta sem id para a mensagem de erro. É o que
 * transforma "não deu certo" em "PatientNameAlreadyExists" na tela do operador.
 */
function describeResult(payload: unknown): string {
  const result =
    readString(payload, 'Result', 'result', 'message', 'Message', 'error') ??
    null;
  if (result) return result;
  try {
    return JSON.stringify(payload).slice(0, 200);
  } catch {
    return 'resposta ilegível';
  }
}
