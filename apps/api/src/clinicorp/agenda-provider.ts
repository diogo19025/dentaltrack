import type {
  AgendaErrorKind,
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
 *
 * O `kind` (P0.1) é a parte que faz a falha ser **acionável**: a tela usa a
 * categoria para dizer ao operador o que fazer, e o transporte a usa para
 * decidir o que pode ser repetido. Antes dele, "credencial recusada" e "Google
 * fora do ar" chegavam à mesma caixa de texto cinza.
 */
export class AgendaProviderError extends Error {
  readonly kind: AgendaErrorKind;
  /**
   * Status HTTP quando a falha veio de uma resposta. Guardado além do `kind`
   * porque há decisão que precisa do código exato: um 404 no cancelamento
   * significa "já não existe" (sucesso), e o `kind` sozinho — `config` — não
   * distingue isso de "a agenda configurada não existe".
   */
  readonly status?: number;

  constructor(
    message: string,
    /**
     * Objeto e não parâmetro posicional de propósito: os campos são todos
     * opcionais, e um `new AgendaProviderError(msg, err)` que passasse a
     * significar "kind = err" seria um bug silencioso em cada chamada antiga.
     */
    options: {
      kind?: AgendaErrorKind;
      status?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'AgendaProviderError';
    this.kind = options.kind ?? 'desconhecido';
    this.status = options.status;
    this.cause = options.cause;
  }
}

/**
 * O horário antigo foi liberado na agenda da empresa e o novo **não** foi
 * criado (P0.1).
 *
 * Nasce do adapter que remarca cancelando e recriando — o Clinicorp, que não
 * expõe reagendamento. Falhar no meio dessa sequência deixa os dois sistemas
 * divergentes: a agenda da empresa ficou sem nada e o DentalTrack continua
 * dizendo que a consulta está de pé no horário velho.
 *
 * O tipo existe para que o chamador possa **registrar a divergência** em vez de
 * só reportar a falha: é a diferença entre um lembrete que sai para uma consulta
 * que não existe mais e um pedido honestamente marcado como não reservado.
 */
export class AgendaSlotReleasedError extends AgendaProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, { kind: 'indisponivel', cause });
    this.name = 'AgendaSlotReleasedError';
  }
}

/**
 * Categoria de uma falha qualquer. Erro que não é do domínio da agenda vira
 * `desconhecido` — não `indisponivel` — porque supor transitoriedade é o que
 * faz um retry insistir contra um bug de código.
 */
export function agendaErrorKind(err: unknown): AgendaErrorKind {
  return err instanceof AgendaProviderError ? err.kind : 'desconhecido';
}

/**
 * A falha passa? Só `indisponivel` e `timeout` — é a lista de motivos em que
 * tentar de novo tem chance de dar outro resultado. Credencial recusada,
 * configuração errada e resposta ilegível não melhoram com insistência: elas
 * precisam de alguém.
 */
export function isTransientAgendaError(err: unknown): boolean {
  const kind = agendaErrorKind(err);
  return kind === 'indisponivel' || kind === 'timeout';
}

/**
 * Status HTTP → categoria, comum aos dois adapters.
 *
 * `404` vira `config` porque, nas rotas que usamos, o recurso é sempre algo que
 * a empresa escolheu (a agenda, a unidade): "não existe" quer dizer que o que
 * está salvo aqui não corresponde ao que existe lá. O caso em que 404 significa
 * "já foi apagado" é tratado por quem chama — o cancelamento —, que conhece a
 * intenção; este mapa, não.
 */
export function kindFromHttpStatus(status: number): AgendaErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'config';
  if (status === 409) return 'conflito';
  if (status === 408 || status === 429 || status >= 500) return 'indisponivel';
  return 'desconhecido';
}
