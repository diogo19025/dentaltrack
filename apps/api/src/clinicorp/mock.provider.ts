import type {
  AvailableSlot,
  ExternalProfessional,
  ExternalStatus,
  ExternalUnit,
} from '@dentaltrack/shared';
import { startOfZonedDay, toZonedParts, zonedTimeToUtc } from '../common/time';
import type {
  AgendaProvider,
  AgendaWindow,
  AvailabilityQuery,
  CreateAppointmentInput,
  CreatePatientInput,
  ExternalAppointment,
  ExternalPatient,
  PatientQuery,
} from './agenda-provider';

/**
 * Agenda sintética determinística (F9) — o que destrava construir e testar as
 * automações **sem nenhuma credencial**.
 *
 * É o mesmo movimento do `LLM_PROVIDER=mock` que já destravou o E2E do motor de
 * IA: um provedor falso, determinístico e offline, atrás da mesma porta que o
 * real. Contra ele os cinco pedidos do cliente rodam de ponta a ponta; quando a
 * credencial chegar, muda-se `mode` para `live` e nada acima da porta é tocado.
 *
 * A agenda é gerada **em relação ao agora**, para que todo cenário interessante
 * esteja sempre presente: consulta em 3 dias, em 1 dia, daqui a pouco, uma
 * atrasada, uma falta de ontem e uma manutenção de 35 dias atrás sem retorno
 * marcado — um caso vivo para cada automação.
 *
 * **Os telefones são propositalmente inválidos** (DDD 00). Um ambiente de
 * desenvolvimento mal configurado apontando para um WhatsApp real não pode
 * mandar lembrete de mentira para o número de alguém: aqui a mensagem falha no
 * transporte, que é o pior resultado aceitável.
 */
export class MockAgendaProvider implements AgendaProvider {
  readonly live = false;

  /** Pacientes criados durante a sessão (agendamento pelo bot). */
  private readonly createdPatients = new Map<string, ExternalPatient>();
  /** Agendamentos criados durante a sessão. */
  private readonly createdAppointments: ExternalAppointment[] = [];
  private sequence = 1000;

  constructor(
    private readonly timeZone: string,
    /** Relógio injetável — é o que torna os testes determinísticos. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  listUnits(): Promise<ExternalUnit[]> {
    return Promise.resolve([
      { id: '1', name: 'Unidade Centro (simulada)' },
      { id: '2', name: 'Unidade Zona Sul (simulada)' },
    ]);
  }

  listProfessionals(unitId?: string | null): Promise<ExternalProfessional[]> {
    const all: ExternalProfessional[] = [
      { id: '10', name: 'Dra. Ana Ribeiro (simulada)', unitId: '1' },
      { id: '11', name: 'Dr. Bruno Lima (simulado)', unitId: '1' },
      { id: '12', name: 'Dra. Carla Souza (simulada)', unitId: '2' },
    ];
    return Promise.resolve(
      unitId ? all.filter((p) => p.unitId === unitId) : all,
    );
  }

  /**
   * Nomes propositalmente parecidos com os de uma conta real — inclusive os
   * ambíguos ("Sala de espera", "Em atendimento"), que são justamente os que
   * obrigam o operador a decidir o mapeamento em vez de aceitar um palpite.
   */
  listStatuses(): Promise<ExternalStatus[]> {
    return Promise.resolve([
      { id: '1', name: 'Agendado' },
      { id: '2', name: 'Confirmado' },
      { id: '3', name: 'Sala de espera' },
      { id: '4', name: 'Em atendimento' },
      { id: '5', name: 'Atendido' },
      { id: '6', name: 'Faltou' },
      { id: '7', name: 'Cancelado' },
      { id: '8', name: 'Orçamento enviado' },
    ]);
  }

  /**
   * Horários de 30 em 30 minutos, das 9h às 17h30, em dias úteis. Alguns são
   * removidos por um critério fixo (não aleatório) para que a agenda pareça
   * ocupada sem quebrar a determinismo dos testes.
   */
  listAvailableSlots(query: AvailabilityQuery): Promise<AvailableSlot[]> {
    const duration = query.durationMinutes ?? 30;
    const slots: AvailableSlot[] = [];
    const nowMs = this.now().getTime();
    const unitId = query.unitId ?? '1';
    const professionalId = query.professionalId ?? '10';

    let day = startOfZonedDay(query.from, this.timeZone);
    const limitMs = query.to.getTime();

    while (day.getTime() <= limitMs && slots.length < 200) {
      const parts = toZonedParts(day, this.timeZone);
      const isWeekend = parts.weekday === 0 || parts.weekday === 6;
      if (!isWeekend) {
        for (let minutes = 9 * 60; minutes <= 17 * 60 + 30; minutes += 30) {
          // Ocupação determinística: descarta ~1 de cada 3 horários.
          if ((parts.day + minutes / 30) % 3 === 0) continue;

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
          if (startsAt.getTime() <= nowMs) continue;

          slots.push({
            startsAt: startsAt.toISOString(),
            endsAt: new Date(
              startsAt.getTime() + duration * 60_000,
            ).toISOString(),
            professionalId,
            professionalName:
              professionalId === '11'
                ? 'Dr. Bruno Lima (simulado)'
                : 'Dra. Ana Ribeiro (simulada)',
            unitId,
          });
        }
      }
      day = new Date(day.getTime() + 24 * 3_600_000);
    }

    const ordered = slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return Promise.resolve(
      query.limit ? ordered.slice(0, query.limit) : ordered,
    );
  }

  listAppointments(query: AgendaWindow): Promise<ExternalAppointment[]> {
    const all = [...this.seedAppointments(), ...this.createdAppointments];
    const from = query.from.getTime();
    const to = query.to.getTime();
    return Promise.resolve(
      all
        .filter(
          (a) => a.startsAt.getTime() >= from && a.startsAt.getTime() <= to,
        )
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  }

  findPatient(query: PatientQuery): Promise<ExternalPatient | null> {
    const phone = query.phone?.replace(/\D/g, '');
    const pool = [...this.seedPatients(), ...this.createdPatients.values()];
    const found =
      (phone
        ? pool.find((p) =>
            p.phone?.replace(/\D/g, '').endsWith(phone.slice(-8)),
          )
        : undefined) ??
      (query.email
        ? pool.find(
            (p) => p.email?.toLowerCase() === query.email?.toLowerCase(),
          )
        : undefined) ??
      (query.name
        ? pool.find(
            (p) => p.name?.toLowerCase() === query.name?.trim().toLowerCase(),
          )
        : undefined) ??
      null;
    return Promise.resolve(found);
  }

  createPatient(input: CreatePatientInput): Promise<ExternalPatient> {
    const patient: ExternalPatient = {
      id: String(++this.sequence),
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
    };
    this.createdPatients.set(patient.id, patient);
    return Promise.resolve(patient);
  }

  createAppointment(
    input: CreateAppointmentInput,
  ): Promise<ExternalAppointment> {
    const created: ExternalAppointment = {
      externalId: `sim-${++this.sequence}`,
      patientExternalId: input.patientId,
      patientName: input.patientName,
      patientPhone: input.patientPhone ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      professionalExternalId: input.professionalId,
      professionalName: null,
      unitExternalId: input.unitId,
      statusExternalId: '1',
      statusName: 'Agendado',
      procedureName: input.procedureName ?? null,
    };
    this.createdAppointments.push(created);
    return Promise.resolve(created);
  }

  private seedPatients(): ExternalPatient[] {
    return [
      { id: '501', name: 'Marina Alves', phone: '5500900000001', email: null },
      {
        id: '502',
        name: 'Rafael Nogueira',
        phone: '5500900000002',
        email: null,
      },
      {
        id: '503',
        name: 'Juliana Peixoto',
        phone: '5500900000003',
        email: null,
      },
      {
        id: '504',
        name: 'Carlos Menezes',
        phone: '5500900000004',
        email: null,
      },
      {
        id: '505',
        name: 'Beatriz Farias',
        phone: '5500900000005',
        email: null,
      },
      { id: '506', name: 'Diego Tavares', phone: '5500900000006', email: null },
    ];
  }

  /**
   * Um caso vivo para cada automação, ancorado no agora. Os `externalId` são
   * estáveis para que a sincronização repetida atualize em vez de duplicar.
   */
  private seedAppointments(): ExternalAppointment[] {
    const patients = this.seedPatients();
    const at = (dayOffset: number, hour: number, minute = 0): Date => {
      const base = startOfZonedDay(this.now(), this.timeZone);
      const parts = toZonedParts(base, this.timeZone);
      return zonedTimeToUtc(
        {
          year: parts.year,
          month: parts.month,
          day: parts.day + dayOffset,
          hour,
          minute,
        },
        this.timeZone,
      );
    };

    const nowParts = toZonedParts(this.now(), this.timeZone);
    // Consulta que começou há ~20 minutos: o caso do aviso de atraso.
    const lateStart = new Date(this.now().getTime() - 20 * 60_000);

    const make = (
      index: number,
      patient: ExternalPatient,
      startsAt: Date,
      status: { id: string; name: string },
      procedureName: string,
      durationMinutes = 30,
    ): ExternalAppointment => ({
      externalId: `sim-seed-${index}`,
      patientExternalId: patient.id,
      patientName: patient.name,
      patientPhone: patient.phone,
      startsAt,
      endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
      professionalExternalId: '10',
      professionalName: 'Dra. Ana Ribeiro (simulada)',
      unitExternalId: '1',
      statusExternalId: status.id,
      statusName: status.name,
      procedureName,
    });

    return [
      // Lembrete de 3 dias dispara agora.
      make(
        1,
        patients[0],
        at(3, 10, 0),
        { id: '1', name: 'Agendado' },
        'Avaliação',
      ),
      // Lembrete de 1 dia dispara agora.
      make(
        2,
        patients[1],
        at(1, 14, 30),
        { id: '2', name: 'Confirmado' },
        'Manutenção',
      ),
      // Lembrete de 1 hora: hoje, mais tarde.
      make(
        3,
        patients[2],
        at(0, Math.min(nowParts.hour + 2, 23), 0),
        { id: '1', name: 'Agendado' },
        'Clareamento',
      ),
      // Atraso: começou há 20 minutos e ninguém marcou a chegada.
      make(
        4,
        patients[3],
        lateStart,
        { id: '1', name: 'Agendado' },
        'Restauração',
      ),
      // Falta de ontem: dispara a cadência de remarcação.
      make(
        5,
        patients[4],
        at(-1, 9, 0),
        { id: '6', name: 'Faltou' },
        'Manutenção',
      ),
      // Manutenção de 35 dias atrás, sem retorno marcado: dispara o recall.
      make(
        6,
        patients[5],
        at(-35, 11, 0),
        { id: '5', name: 'Atendido' },
        'Manutenção periódica',
      ),
      // Atendido, mas não é manutenção — não deve gerar recall.
      make(
        7,
        patients[0],
        at(-40, 15, 0),
        { id: '5', name: 'Atendido' },
        'Clareamento',
      ),
    ];
  }
}
