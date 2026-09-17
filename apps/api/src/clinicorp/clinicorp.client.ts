import { Logger } from '@nestjs/common';
import { withRetry, type RetryOptions } from '../common/http-retry';
import {
  AgendaProviderError,
  isTransientAgendaError,
  kindFromHttpStatus,
} from './agenda-provider';
import { normalizeEntityIds } from './field-reader';

/**
 * Cliente HTTP do Clinicorp (F9). Só transporte: autenticação, montagem de
 * URL, timeout e tradução de falha — nenhuma regra de agenda mora aqui.
 *
 * Autenticação é **HTTP Basic com um par usuário/token de API**, que não é o
 * login do painel web da clínica; e a maior parte das rotas exige ainda o
 * `subscriber_id` como contexto de conta. Ambos são pedidos ao suporte pelo
 * assinante (o dono da clínica) — ver docs/CLINICORP.md.
 */

/** Base pública da API. Homologação sobrescreve via credencial. */
export const CLINICORP_DEFAULT_BASE_URL = 'https://api.clinicorp.com/rest/v1';

/**
 * Rotas usadas pelo conector, do contrato OpenAPI publicado pelo fornecedor.
 *
 * As grafias são reproduzidas **literalmente**, inclusive onde o próprio
 * fornecedor as digitou errado (`get_avaliable_days`): corrigir a ortografia
 * aqui daria 404. Se alguma divergir na primeira chamada real, este objeto é o
 * único lugar a mexer.
 */
export const CLINICORP_ROUTES = {
  /** Sem parâmetro: é como se descobre o `subscriber_id` da credencial. */
  subscribers: '/group/list_subscribers',
  subscriberClinics: '/group/list_subscribers_clinics',
  units: '/business/list',
  chairs: '/business/list_chairs',
  professionals: '/professional/list_all_professionals',
  statuses: '/appointment/status_list',
  availableTimes: '/business/list_available_times',
  appointments: '/appointment/list',
  appointmentInfo: '/appointment/list_info',
  appointmentCategories: '/appointment/list_categories',
  patientAppointments: '/patient/list_appointments',
  patientSearch: '/patient/get',
  patientCreate: '/patient/create',
  procedures: '/procedures/list',
  createAppointment: '/appointment/create_appointment_by_api',
  confirmAppointment: '/appointment/confirm_appointment',
  cancelAppointment: '/appointment/cancel_appointment',
  changeStatus: '/appointment/change_status',
  // Agendamento público (plano B, por `code_link`) — não usado por padrão.
  onlineAvailableDays: '/appointment/get_avaliable_days',
  onlineAvailableTimes: '/appointment/get_avaliable_times_calendar',
  createOnlineScheduling: '/appointment/create_online_scheduling',
} as const;

/**
 * Rotas que **não** recebem `subscriber_id` — o contrato não o declara nelas
 * (a disponibilidade e a criação identificam a conta pela credencial), e as de
 * descoberta existem justamente para quando ele ainda não é conhecido. A
 * exceção fica explícita e documentada em vez de virar um bug intermitente.
 */
const ROUTES_WITHOUT_SUBSCRIBER: string[] = [
  CLINICORP_ROUTES.subscribers,
  CLINICORP_ROUTES.subscriberClinics,
  CLINICORP_ROUTES.availableTimes,
  CLINICORP_ROUTES.createAppointment,
];

export interface ClinicorpConfig {
  username: string;
  token: string;
  subscriberId: string | null;
  baseUrl?: string | null;
  timeoutMs?: number;
  /** Injetável para teste — nenhum teste deste repositório toca a rede. */
  fetchImpl?: typeof fetch;
  /** Política de repetição das leituras (o teste substitui a espera). */
  retry?: Pick<RetryOptions, 'attempts' | 'baseDelayMs' | 'sleep'>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Categoria da falha. O Clinicorp sinaliza horário ocupado com **400** e a
 * mensagem "O horário solicitado encontra-se ocupado" (visto ao vivo em
 * 2026-09-17), não com 409 — sem esta leitura o agente trataria o conflito
 * como falha nossa e prometeria o retorno da equipe em vez de oferecer outro
 * horário.
 */
export function classifyFailure(status: number, detail: string) {
  if (status === 400 && /ocupad/i.test(detail)) return 'conflito' as const;
  return kindFromHttpStatus(status);
}

export class ClinicorpClient {
  private readonly logger = new Logger(ClinicorpClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ClinicorpConfig) {
    this.baseUrl = (
      config.baseUrl?.trim() || CLINICORP_DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Leitura: repetida quando a falha é transitória (P0.1). */
  async get(
    path: string,
    query: Record<string, string | number | null | undefined> = {},
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(
      this.withSubscriber(path, query),
    )) {
      if (value === null || value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return withRetry(() => this.request(path, url, { method: 'GET' }), {
      ...this.config.retry,
      isRetryable: isTransientAgendaError,
      onRetry: ({ attempt, delayMs }) =>
        this.logger.warn(
          `Clinicorp ${path} falhou (tentativa ${attempt}); repetindo em ${delayMs}ms.`,
        ),
    });
  }

  /**
   * Escrita: **nunca repetida**. As rotas de criação do Clinicorp não são
   * idempotentes e já respondem 200 sem criar nada em alguns casos — repetir
   * um `create_appointment_by_api` que na verdade funcionou é exatamente como
   * se marca a mesma consulta duas vezes na agenda do cliente.
   */
  async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    const payload = normalizeEntityIds(this.withSubscriber(path, body));
    return this.request(path, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /** Cabeçalho Basic — exposto para o teste de conexão poder reusá-lo. */
  authorizationHeader(): string {
    const raw = `${this.config.username}:${this.config.token}`;
    return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
  }

  /**
   * `subscriber_id` efetivo. Verificado ao vivo (2026-09-17): numa conta única
   * `GET /group/list_subscribers` responde `[]` e as rotas recusam com 400 sem
   * o id — e o valor aceito é o **próprio usuário da API**. Por isso o usuário
   * é o padrão quando o campo fica vazio; contas de grupo informam o da unidade.
   */
  subscriberId(): string {
    return this.config.subscriberId?.trim() || this.config.username;
  }

  private withSubscriber<T extends Record<string, unknown>>(
    path: string,
    payload: T,
  ): T & { subscriber_id?: string } {
    if (ROUTES_WITHOUT_SUBSCRIBER.includes(path)) return payload;
    return { subscriber_id: this.subscriberId(), ...payload };
  }

  private async request(
    path: string,
    url: URL,
    init: RequestInit,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers ?? {}),
          Authorization: this.authorizationHeader(),
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        // 401/403 quase sempre é credencial errada ou plano sem a rota
        // liberada — vale dizer isso em vez de repetir o código HTTP.
        const hint =
          res.status === 401 || res.status === 403
            ? ' (verifique usuário/token da API e se a rota está liberada no plano)'
            : '';
        throw new AgendaProviderError(
          `Clinicorp ${path} respondeu ${res.status}${hint}${
            detail ? `: ${detail.slice(0, 300)}` : ''
          }`,
          { kind: classifyFailure(res.status, detail), status: res.status },
        );
      }

      const text = await res.text();
      if (!text.trim()) return undefined;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new AgendaProviderError(
          `Clinicorp ${path} devolveu uma resposta que não é JSON: ${text.slice(0, 200)}`,
          { kind: 'resposta_invalida', status: res.status },
        );
      }
    } catch (err) {
      if (err instanceof AgendaProviderError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AgendaProviderError(
          `Clinicorp ${path} não respondeu em ${this.timeoutMs}ms.`,
          { kind: 'timeout', cause: err },
        );
      }
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha na chamada ${path}: ${detail}`);
      throw new AgendaProviderError(
        `Não foi possível falar com o Clinicorp (${path}): ${detail}`,
        { kind: 'indisponivel', cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
