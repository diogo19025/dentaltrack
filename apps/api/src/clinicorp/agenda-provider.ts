import type {
  AvailableSlot,
  ExternalProfessional,
  ExternalStatus,
  ExternalUnit,
} from '@dentaltrack/shared';

/**
 * **A porta da agenda** (F9) — o contrato que o resto do sistema enxerga.
 *
 * Nada acima desta interface sabe que existe Clinicorp: as automações, o motor
 * do agente e a tela falam só com `AgendaProvider`. É a mesma disciplina de
 * *ports & adapters* que fez o WhatsApp entrar sem tocar no motor do agente
 * (ver CLAUDE.md), aplicada agora ao sistema de gestão.
 *
 * Três implementações a satisfazem:
 * - `MockAgendaProvider` — dados sintéticos determinísticos. É o que permite
 *   construir e testar as cinco automações **antes** de a credencial do cliente
 *   existir, do mesmo jeito que `LLM_PROVIDER=mock` destravou o E2E da IA;
 * - `ClinicorpAgendaProvider` — a API real;
 * - `null` (integração desligada) — o chamador cai para a disponibilidade
 *   declarada em `/settings`, que é o comportamento pré-F9.
 *
 * Toda instância já nasce amarrada a **uma** empresa (credencial + unidade),
 * então nenhum método recebe `clinicId`: o escopo é do objeto, não do parâmetro.
 */
export interface AgendaProvider {
  /**
   * `true` quando os dados vêm do sistema real da empresa. O agente usa isto
   * para calibrar o que promete ao cliente — oferecer um horário "confirmado"
   * que na verdade saiu de um quadro declarado à mão seria mentir com convicção.
   */
  readonly live: boolean;

  /** Unidades/consultórios da conta (wizard de conexão). */
  listUnits(): Promise<ExternalUnit[]>;

  /** Profissionais da conta, opcionalmente filtrados por unidade. */
  listProfessionals(unitId?: string | null): Promise<ExternalProfessional[]>;

  /**
   * Status de agendamento como a conta os nomeia. Nunca são usados direto: o
   * operador mapeia cada um para os seis status do nosso domínio.
   */
  listStatuses(): Promise<ExternalStatus[]>;

  /** Horários livres na janela pedida. */
  listAvailableSlots(query: AvailabilityQuery): Promise<AvailableSlot[]>;

  /** Agendamentos na janela pedida — a fonte da sincronização. */
  listAppointments(query: AgendaWindow): Promise<ExternalAppointment[]>;

  /**
   * Procura um paciente já existente. Resolver o paciente **antes** de agendar
   * não é otimização: a API pode responder 200 sem criar nada quando o nome já
   * existe, e aí o agendamento se perde silenciosamente.
   */
  findPatient(query: PatientQuery): Promise<ExternalPatient | null>;

  /** Cria o paciente quando a busca não achou ninguém. */
  createPatient(input: CreatePatientInput): Promise<ExternalPatient>;

  /**
   * Cria o agendamento. **Obrigatoriamente** devolve o id externo — implementação
   * que não conseguir confirmá-lo deve lançar, nunca retornar sucesso vazio.
   */
  createAppointment(
    input: CreateAppointmentInput,
  ): Promise<ExternalAppointment>;

  /**
   * Cancela o agendamento na agenda real (P0.5). **Idempotente por transição:**
   * o que já está cancelado ou já não existe lá conta como sucesso — repetir
   * a operação (duplo clique, retry) não pode virar erro nem segunda escrita.
   * Só lança quando a agenda recusou ou não respondeu.
   */
  cancelAppointment(input: CancelAppointmentInput): Promise<void>;

  /**
   * Move o agendamento para outro horário. Devolve o agendamento **como ficou**
   * — inclusive o `externalId`, que pode mudar quando o fornecedor não oferece
   * reagendamento e o adapter precisa cancelar e recriar (caso do Clinicorp).
   */
  rescheduleAppointment(
    input: RescheduleAppointmentInput,
  ): Promise<ExternalAppointment>;
}

/** Janela de datas (inclusiva nas duas pontas, no fuso da empresa). */
export interface AgendaWindow {
  from: Date;
  to: Date;
  unitId?: string | null;
}

export interface AvailabilityQuery extends AgendaWindow {
  professionalId?: string | null;
  /** Duração desejada em minutos (default do provedor quando ausente). */
  durationMinutes?: number | null;
  /** Teto de horários devolvidos — o agente só oferece um punhado por vez. */
  limit?: number;
}

export interface PatientQuery {
  phone?: string | null;
  name?: string | null;
  email?: string | null;
}

export interface ExternalPatient {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface CreatePatientInput {
  name: string;
  phone?: string | null;
  email?: string | null;
}

export interface CreateAppointmentInput {
  patientId: string | null;
  patientName: string;
  patientPhone?: string | null;
  patientEmail?: string | null;
  startsAt: Date;
  endsAt: Date;
  unitId: string;
  professionalId: string;
  procedureName?: string | null;
  notes?: string | null;
}

export interface CancelAppointmentInput {
  externalId: string;
  /** Contexto para o adapter que precisa dele (unidade no Clinicorp). */
  unitId?: string | null;
}

/**
 * Tudo o que `createAppointment` recebe, mais o id externo atual — porque o
 * adapter que remarca por cancelar + recriar precisa reconstruir o
 * agendamento inteiro, não só mover o horário.
 */
export interface RescheduleAppointmentInput extends CreateAppointmentInput {
  externalId: string;
}

/** Um agendamento como ele existe no sistema de gestão, já normalizado. */
export interface ExternalAppointment {
  externalId: string;
  patientExternalId: string | null;
  patientName: string | null;
  patientPhone: string | null;
  startsAt: Date;
  endsAt: Date | null;
  professionalExternalId: string | null;
  professionalName: string | null;
  unitExternalId: string | null;
  /** Status cru da conta — traduzido depois pelo mapeamento do operador. */
  statusExternalId: string | null;
  statusName: string | null;
  procedureName: string | null;
}

/**
 * Falha de comunicação com o sistema de gestão. Existe para que o chamador
 * possa degradar com elegância (cair para a disponibilidade declarada, adiar a
 * sincronização) em vez de propagar um 500 para o cliente no WhatsApp.
 */
export class AgendaProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgendaProviderError';
  }
}
