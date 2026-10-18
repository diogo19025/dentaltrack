import { Logger } from '@nestjs/common';
import type { MediaAttachment } from '@dentaltrack/shared';
import type {
  InboundAudioRef,
  WhatsappRecipient,
  WhatsappTransport,
} from './whatsapp-transport';

const TIMEOUT_MS = 20_000;
const GRAPH_BASE = 'https://graph.facebook.com';

/**
 * Erro da Graph API. `code` é o código da Meta (não o HTTP): é ele que diz o
 * motivo, por exemplo 131047 = a conversa saiu da janela de 24 horas e só
 * mensagem de modelo (template) é aceita.
 */
export class MetaRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = 'MetaRequestError';
  }
}

/** Fora da janela de 24 horas: só template (ainda não suportado aqui). */
export const META_OUTSIDE_WINDOW = 131047;

/**
 * Adapter da Cloud API oficial da Meta atrás da porta `WhatsappTransport`,
 * amarrado ao número (phone number id) da empresa. Escritas nunca são
 * repetidas aqui: repetir um envio é como se duplica mensagem; quem decide
 * tentar de novo é a fila de saída, que tem chave de idempotência.
 */
export class MetaTransport implements WhatsappTransport {
  private readonly logger = new Logger(MetaTransport.name);

  constructor(
    readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly graphVersion = 'v21.0',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** A Meta endereça pelo telefone (dígitos com DDI): não há LID nem JID. */
  resolveAddress(recipient: WhatsappRecipient): Promise<string> {
    return Promise.resolve(recipient.phone);
  }

  async sendText(address: string, text: string): Promise<void> {
    await this.send({
      to: address,
      type: 'text',
      text: { body: text, preview_url: false },
    });
  }

  /** Mídia por URL pública. Áudio sai como `audio`; documento como `document`. */
  async sendMedia(address: string, attachment: MediaAttachment): Promise<void> {
    const type = attachment.type;
    const link = { link: attachment.url };
    const caption = attachment.caption
      ? { caption: attachment.caption }
      : undefined;
    switch (type) {
      case 'image':
        return this.send({ to: address, type, image: { ...link, ...caption } });
      case 'video':
        return this.send({ to: address, type, video: { ...link, ...caption } });
      case 'audio':
        return this.send({ to: address, type, audio: link });
      default:
        return this.send({
          to: address,
          type: 'document',
          document: { ...link, ...caption },
        });
    }
  }

  /**
   * O áudio recebido chega como id de mídia: resolve a URL temporária e baixa
   * com o mesmo token. `undefined` se a Meta não devolver (o turno é ignorado).
   */
  async fetchInboundAudio(audio: InboundAudioRef): Promise<string | undefined> {
    if (audio.base64) return audio.base64;
    const mediaId = typeof audio.ref === 'string' ? audio.ref : null;
    if (!mediaId) return undefined;
    try {
      const meta = (await this.request('GET', `/${mediaId}`)) as {
        url?: string;
      };
      if (!meta.url) return undefined;
      const res = await this.fetchWithTimeout(meta.url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!res.ok) return undefined;
      return Buffer.from(await res.arrayBuffer()).toString('base64');
    } catch (err) {
      this.logger.warn(
        `Áudio ${mediaId} não pôde ser baixado: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  /** Dados do número (validação das credenciais). */
  async fetchPhoneInfo(): Promise<{
    displayPhone: string | null;
    verifiedName: string | null;
  }> {
    const info = (await this.request(
      'GET',
      `/${this.phoneNumberId}?fields=display_phone_number,verified_name`,
    )) as { display_phone_number?: string; verified_name?: string };
    return {
      displayPhone: info.display_phone_number ?? null,
      verifiedName: info.verified_name ?? null,
    };
  }

  private async send(message: Record<string, unknown>): Promise<void> {
    await this.request('POST', `/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...message,
    });
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchWithTimeout(
        `${GRAPH_BASE}/${this.graphVersion}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      throw new MetaRequestError(
        timedOut
          ? 'A Meta não respondeu a tempo.'
          : `Falha de rede ao falar com a Meta: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        undefined,
        timedOut,
      );
    }

    const payload = (await res.json().catch(() => null)) as {
      error?: { message?: string; code?: number };
    } | null;
    if (!res.ok) {
      throw new MetaRequestError(
        payload?.error?.message ?? `Meta respondeu ${res.status}`,
        res.status,
        payload?.error?.code,
      );
    }
    return payload;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
