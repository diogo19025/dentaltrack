import type {
  AvailableSlot,
  ExternalProfessional,
  ExternalStatus,
  ExternalUnit,
  GoogleAgendaConfig,
} from '@dentaltrack/shared';
import {
  parseHhMm,
  startOfZonedDay,
  toZonedParts,
  zonedTimeToUtc,
} from '../common/time';
import type {
  AgendaProvider,
  AgendaWindow,
  AvailabilityQuery,
  CreateAppointmentInput,
  CreatePatientInput,
  ExternalAppointment,
  ExternalPatient,
  PatientQuery,
} from '../clinicorp/agenda-provider';
import type {
  GoogleCalendarClient,
  GoogleEvent,
} from './google-calendar.client';

/**
 * Google Agenda atrás da porta `AgendaProvider` (F12).
 *
 * A mesma disciplina de ports & adapters da F9: nada acima da porta sabe se a
 * agenda é Clinicorp ou Google. As diferenças de natureza ficam contidas aqui:
 *
 * - o Google **não tem cadastro de pacientes** — `findPatient` nunca acha e
 *   `createPatient` devolve um id vazio (o vínculo lead↔paciente externo não
 *   se aplica; os dados do paciente viajam no próprio evento);
 * - o Google **não sabe o expediente** — os horários livres saem da janela de
 *   trabalho configurada pela empresa menos os intervalos ocupados (free/busy);
 * - o Google **não registra presença** — os status são só marcado/cancelado,
 *   então as automações de falta e de retorno não têm o que observar (limite
 *   honesto do provedor, avisado na tela).
 */

/** Id sintético do "profissional" — o Google agenda por calendário, não por pessoa. */
export const GOOGLE_PROFESSIONAL_ID = 'google-agenda';

/**
 * Status do Google traduzidos para nomes que a heurística de mapeamento já
 * reconhece — a conta nasce com o mapeamento sugerido certo, sem toque manual.
 */
const GOOGLE_STATUSES: ExternalStatus[] = [
  { id: 'confirmed', name: 'Marcado (Google)' },
  { id: 'tentative', name: 'Aguardando confirmação (Google)' },
  { id: 'cancelled', name: 'Cancelado (Google)' },
];

/** Chaves das extendedProperties gravadas nos eventos criados pelo agente. */
const PROP_MARKER = 'dentaltrack';
const PROP_PATIENT_NAME = 'dentaltrackPatientName';
const PROP_PATIENT_PHONE = 'dentaltrackPatientPhone';
const PROP_PROCEDURE = 'dentaltrackProcedure';

const MAX_GRID_SLOTS = 200;

export class GoogleAgendaProvider implements AgendaProvider {
  readonly live = true;

  constructor(
    private readonly client: GoogleCalendarClient,
    private readonly timeZone: string,
    private readonly config: GoogleAgendaConfig,
    /** Relógio injetável — testes determinísticos, como no mock. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** A "unidade" é a própria agenda — e buscá-la valida o compartilhamento. */
  async listUnits(): Promise<ExternalUnit[]> {
    const calendar = await this.client.getCalendar(this.config.calendarId);
    return [
      {
        id: this.config.calendarId,
        name: calendar.summary ?? this.config.calendarId,
      },
    ];
  }

  async listProfessionals(): Promise<ExternalProfessional[]> {
    const [unit] = await this.listUnits();
    return [
      {
        id: GOOGLE_PROFESSIONAL_ID,
        name: unit?.name ?? 'Agenda Google',
        unitId: this.config.calendarId,
      },
    ];
  }

  listStatuses(): Promise<ExternalStatus[]> {
    return Promise.resolve([...GOOGLE_STATUSES]);
  }

  /**
   * Janela de trabalho configurada − intervalos ocupados (free/busy) = grade
   * de horários livres. O free/busy já enxerga evento recorrente, dia inteiro
   * e convite aceito — tudo que ocupa a agenda conta como ocupado.
   */
  async listAvailableSlots(query: AvailabilityQuery): Promise<AvailableSlot[]> {
    const duration = query.durationMinutes ?? this.config.slotMinutes;
    const step = this.config.slotMinutes;
    const startMinutes = parseHhMm(this.config.workStart, 8 * 60);
    const endMinutes = parseHhMm(this.config.workEnd, 18 * 60);
    const workDays = new Set(this.config.workDays);

    const busy = await this.client.freeBusy(
      this.config.calendarId,
      query.from,
      query.to,
    );
    const nowMs = this.now().getTime();
    const limitMs = query.to.getTime();
    const slots: AvailableSlot[] = [];

    let day = startOfZonedDay(query.from, this.timeZone);
    while (day.getTime() <= limitMs && slots.length < MAX_GRID_SLOTS) {
      const parts = toZonedParts(day, this.timeZone);
      if (workDays.has(parts.weekday)) {
        for (
          let minutes = startMinutes;
          minutes + duration <= endMinutes;
          minutes += step
        ) {
          const startsAt = zonedTimeToUtc(
            {
              year: parts.year,
              month: parts.month,
              day: parts.day,
              hour: Math.floor(minutes / 60),
              minute: minutes % 60,
            },
            this.timeZone,
          );
          const endsAt = new Date(startsAt.getTime() + duration * 60_000);
          if (startsAt.getTime() <= nowMs) continue;
          if (endsAt.getTime() > limitMs) continue;
          if (
            busy.some(
              (b) =>
                startsAt.getTime() < b.end.getTime() &&
                endsAt.getTime() > b.start.getTime(),
            )
          ) {
            continue;
          }

          slots.push({
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            professionalId: GOOGLE_PROFESSIONAL_ID,
            professionalName: null,
            unitId: this.config.calendarId,
          });
        }
      }
      day = new Date(day.getTime() + 24 * 3_600_000);
    }

    const ordered = slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return query.limit ? ordered.slice(0, query.limit) : ordered;
  }

  async listAppointments(query: AgendaWindow): Promise<ExternalAppointment[]> {
    const events = await this.client.listEvents(
      this.config.calendarId,
      query.from,
      query.to,
    );
    return events
      .map((event) => this.toAppointment(event))
      .filter((a): a is ExternalAppointment => a !== null)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  /** O Google não tem cadastro de pacientes — nunca há um para achar. */
  findPatient(_query: PatientQuery): Promise<ExternalPatient | null> {
    return Promise.resolve(null);
  }

  /**
   * Id vazio de propósito: não existe entidade "paciente" no Google, e um id
   * inventado acabaria gravado em `lead.externalId` como se fosse real. Os
   * dados viajam no evento (extendedProperties), não num cadastro.
   */
  createPatient(input: CreatePatientInput): Promise<ExternalPatient> {
    return Promise.resolve({
      id: '',
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
    });
  }

  async createAppointment(
    input: CreateAppointmentInput,
  ): Promise<ExternalAppointment> {
    const summary = input.procedureName
      ? `${input.procedureName} — ${input.patientName}`
      : `Consulta — ${input.patientName}`;
    const description = [
      input.patientPhone ? `Telefone: ${input.patientPhone}` : null,
      input.notes,
      'Agendado pelo agente.',
    ]
      .filter(Boolean)
      .join('\n');

    const event = await this.client.createEvent(this.config.calendarId, {
      summary,
      description,
      start: {
        dateTime: input.startsAt.toISOString(),
        timeZone: this.timeZone,
      },
      end: { dateTime: input.endsAt.toISOString(), timeZone: this.timeZone },
      extendedProperties: {
        private: {
          [PROP_MARKER]: '1',
          [PROP_PATIENT_NAME]: input.patientName,
          ...(input.patientPhone
            ? { [PROP_PATIENT_PHONE]: input.patientPhone }
            : {}),
          ...(input.procedureName
            ? { [PROP_PROCEDURE]: input.procedureName }
            : {}),
        },
      },
    });

    const created = this.toAppointment(event);
    if (!created) {
      // Contrato da porta: sucesso sem id externo confirmado não existe.
      throw new Error('O Google não devolveu o evento criado.');
    }
    return created;
  }

  /** Evento → agendamento normalizado. Dia inteiro e sem horário viram `null`. */
  private toAppointment(event: GoogleEvent): ExternalAppointment | null {
    if (!event.id) return null;
    const startsAt = event.start?.dateTime
      ? new Date(event.start.dateTime)
      : null;
    if (!startsAt || Number.isNaN(startsAt.getTime())) return null;
    const endsAt = event.end?.dateTime ? new Date(event.end.dateTime) : null;

    const props = event.extendedProperties?.private ?? {};
    const ours = props[PROP_MARKER] === '1';
    const status =
      GOOGLE_STATUSES.find((s) => s.id === event.status) ?? GOOGLE_STATUSES[0];

    return {
      externalId: event.id,
      patientExternalId: null,
      // Evento criado pelo agente carrega o paciente nas propriedades; evento
      // criado à mão no Google só tem o título — que é o melhor nome disponível.
      patientName: ours
        ? (props[PROP_PATIENT_NAME] ?? null)
        : (event.summary ?? null),
      patientPhone: props[PROP_PATIENT_PHONE] ?? null,
      startsAt,
      endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
      professionalExternalId: GOOGLE_PROFESSIONAL_ID,
      professionalName: null,
      unitExternalId: this.config.calendarId,
      statusExternalId: status.id,
      statusName: status.name,
      procedureName: props[PROP_PROCEDURE] ?? null,
    };
  }
}
