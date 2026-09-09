import { createSign } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { AgendaProviderError } from '../clinicorp/agenda-provider';

/**
 * Cliente HTTP do Google Calendar (F12). Só transporte: autenticação, montagem
 * de URL, timeout e tradução de falha — nenhuma regra de agenda mora aqui.
 *
 * Autenticação é por **service account** (JWT RS256 trocado por access token),
 * e não OAuth por empresa, de propósito: o consumo é de cron e de webhook, sem
 * navegador por perto, e um refresh token de usuário expirando no meio de uma
 * sincronização é exatamente a classe de falha que este produto não pode ter.
 * A empresa "autoriza" compartilhando a agenda dela com o e-mail da conta de
 * serviço — revogável por ela a qualquer momento, direto no Google.
 */

const CALENDAR_BASE_URL = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

const DEFAULT_TIMEOUT_MS = 15_000;
/** Renova o token um pouco antes de expirar, para nunca usar um vencido. */
const TOKEN_SLACK_MS = 60_000;

export interface GoogleCalendarConfig {
  serviceAccountEmail: string;
  /** Chave privada PEM (aceita "\n" escapado e base64 — formatos usuais de env). */
  privateKey: string;
  timeoutMs?: number;
  /** Injetáveis para teste. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** Evento como o Google o devolve (só os campos que usamos). */
export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface GoogleCalendarInfo {
  id?: string;
  summary?: string;
  timeZone?: string;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export class GoogleCalendarClient {
  private readonly logger = new Logger(GoogleCalendarClient.name);
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly privateKey: string;

  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private readonly config: GoogleCalendarConfig) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? (() => new Date());
    this.privateKey = normalizePrivateKey(config.privateKey);
  }

  /** Metadados da agenda — é o "a credencial funciona?" do Google. */
  async getCalendar(calendarId: string): Promise<GoogleCalendarInfo> {
    return (await this.request(
      'GET',
      `/calendars/${encodeURIComponent(calendarId)}`,
    )) as GoogleCalendarInfo;
  }

  /** Intervalos ocupados na janela — a base do cálculo de horários livres. */
  async freeBusy(
    calendarId: string,
    from: Date,
    to: Date,
  ): Promise<BusyInterval[]> {
    const body = {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: calendarId }],
    };
    const result = (await this.request('POST', '/freeBusy', {
      body,
    })) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    };
    const busy = result.calendars?.[calendarId]?.busy ?? [];
    return busy
      .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
      .filter(
        (b) =>
          !Number.isNaN(b.start.getTime()) && !Number.isNaN(b.end.getTime()),
      );
  }

  /**
   * Eventos na janela, com recorrências expandidas e **incluindo cancelados** —
   * é o cancelamento que a sincronização mais precisa enxergar.
   */
  async listEvents(
    calendarId: string,
    from: Date,
    to: Date,
  ): Promise<GoogleEvent[]> {
    const events: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const page = (await this.request(
        'GET',
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          query: {
            timeMin: from.toISOString(),
            timeMax: to.toISOString(),
            singleEvents: 'true',
            showDeleted: 'true',
            maxResults: '2500',
            ...(pageToken ? { pageToken } : {}),
          },
        },
      )) as { items?: GoogleEvent[]; nextPageToken?: string };
      events.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return events;
  }

  async createEvent(
    calendarId: string,
    event: Record<string, unknown>,
  ): Promise<GoogleEvent> {
    return (await this.request(
      'POST',
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { body: event },
    )) as GoogleEvent;
  }

  /**
   * Altera campos do evento (P0.5 — remarcar). `PATCH` e não `PUT`: só o que
   * for enviado muda, e o resto do evento (descrição, propriedades do
   * agente) fica como está.
   */
  async patchEvent(
    calendarId: string,
    eventId: string,
    patch: Record<string, unknown>,
  ): Promise<GoogleEvent> {
    return (await this.request(
      'PATCH',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { body: patch },
    )) as GoogleEvent;
  }

  /**
   * Apaga o evento (P0.5 — cancelar). **Idempotente:** 404 (não existe) e 410
   * (já apagado) contam como sucesso — o estado final é o mesmo, e a porta
   * exige que repetir o cancelamento não vire erro.
   */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.request(
      'DELETE',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { tolerateStatuses: [404, 410] },
    );
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: {
      query?: Record<string, string>;
      body?: Record<string, unknown>;
      /** Códigos de erro que valem como sucesso sem corpo (ver `deleteEvent`). */
      tolerateStatuses?: number[];
    } = {},
  ): Promise<unknown> {
    const token = await this.getAccessToken();
    const url = new URL(`${CALENDAR_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await this.send(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    if (!response.ok) {
      if (options.tolerateStatuses?.includes(response.status)) return undefined;
      throw new AgendaProviderError(
        `Google Calendar respondeu ${response.status} em ${path}: ${await safeBody(response)}`,
      );
    }
    // `DELETE` responde 204 sem corpo — `json()` aqui explodiria com sucesso.
    if (response.status === 204) return undefined;
    return response.json();
  }

  /**
   * Access token da service account (cacheado até perto de expirar): assina um
   * JWT com a chave privada e o troca no endpoint de token do Google.
   */
  private async getAccessToken(): Promise<string> {
    const nowMs = this.now().getTime();
    if (
      this.accessToken &&
      nowMs < this.accessTokenExpiresAt - TOKEN_SLACK_MS
    ) {
      return this.accessToken;
    }

    const iat = Math.floor(nowMs / 1000);
    const assertion = this.signJwt({
      iss: this.config.serviceAccountEmail,
      scope: CALENDAR_SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    });

    const response = await this.send(new URL(TOKEN_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });

    if (!response.ok) {
      throw new AgendaProviderError(
        `O Google recusou a service account (${response.status}): ${await safeBody(response)}`,
      );
    }

    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new AgendaProviderError(
        'O Google não devolveu um access token para a service account.',
      );
    }

    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = nowMs + (data.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  private signJwt(claims: Record<string, unknown>): string {
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64Url(JSON.stringify(claims));
    const input = `${header}.${payload}`;
    try {
      const signature = createSign('RSA-SHA256')
        .update(input)
        .sign(this.privateKey);
      return `${input}.${signature.toString('base64url')}`;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new AgendaProviderError(
        `A chave privada da service account do Google é inválida: ${detail}`,
        err,
      );
    }
  }

  private async send(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      const timedOut = controller.signal.aborted;
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao chamar ${url.pathname}: ${detail}`);
      throw new AgendaProviderError(
        timedOut
          ? `O Google Calendar não respondeu em ${this.timeoutMs} ms.`
          : `Não foi possível falar com o Google Calendar: ${detail}`,
        err,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Aceita a chave como PEM puro, PEM com `\n` escapado (o formato usual num
 * `.env`) ou o PEM inteiro em base64 — devolve sempre PEM utilizável.
 */
export function normalizePrivateKey(raw: string): string {
  const unescaped = raw.trim().replace(/\\n/g, '\n');
  if (unescaped.includes('BEGIN')) return unescaped;
  try {
    const decoded = Buffer.from(unescaped, 'base64').toString('utf8');
    if (decoded.includes('BEGIN')) return decoded;
  } catch {
    // cai no retorno abaixo — a assinatura vai falhar com mensagem clara.
  }
  return unescaped;
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

async function safeBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return '(corpo ilegível)';
  }
}
