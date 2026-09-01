import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaAttachment } from '@dentaltrack/shared';
import type { Env } from '../config/env.validation';

/** Limites do "digitando" (delay anti-ban) antes de enviar uma resposta. */
const TYPING_MS_PER_CHAR = 35;
const TYPING_MIN_MS = 1200;
const TYPING_MAX_MS = 8000;

/**
 * Cliente de **saída** da Evolution API (WA-3). Envia mensagens e busca mídia
 * (áudio) via REST, autenticando com a chave global (header `apikey`). Não
 * conhece o motor do agente — é só o transporte do canal WhatsApp.
 */
@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);
  /** Cache telefone(JID) → JID `@lid` (o LID é estável por contato). */
  private readonly lidByPhoneJid = new Map<string, string>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** A Evolution está configurada? (sem URL/chave o WhatsApp fica inativo.) */
  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /**
   * Envia uma mensagem de texto. `to` é um telefone (dígitos) **ou** um JID
   * completo (ex.: `<lid>@lid` — necessário p/ contatos migrados p/ LID, senão
   * a mensagem fica presa em PENDING e nunca entrega). Aplica um `delay`
   * (indicador "digitando") proporcional ao tamanho do texto — higiene anti-ban
   * (WA-4): respostas instantâneas parecem robô e aumentam risco de banimento.
   */
  async sendText(instance: string, to: string, text: string): Promise<void> {
    const delay = this.typingDelay(text);
    await this.post(`/message/sendText/${instance}`, {
      number: to,
      text,
      delay,
    });
  }

  /**
   * Envia uma mídia (F6) a partir de uma **URL pública**: imagem, vídeo,
   * documento (catálogo) ou áudio. `to` é telefone ou JID (igual ao `sendText`).
   * Áudio usa o endpoint dedicado `sendWhatsAppAudio` (vira mensagem de voz/PTT);
   * o restante usa `sendMedia` com o `mediatype` correspondente. Aplica o mesmo
   * delay "digitando" (higiene anti-ban, WA-4).
   */
  async sendMedia(
    instance: string,
    to: string,
    attachment: MediaAttachment,
  ): Promise<void> {
    const delay = this.typingDelay(attachment.caption ?? '');
    if (attachment.type === 'audio') {
      await this.post(`/message/sendWhatsAppAudio/${instance}`, {
        number: to,
        audio: attachment.url,
        delay,
      });
      return;
    }
    await this.post(`/message/sendMedia/${instance}`, {
      number: to,
      mediatype: attachment.type,
      media: attachment.url,
      ...(attachment.caption ? { caption: attachment.caption } : {}),
      delay,
    });
  }

  /**
   * Resolve o JID `@lid` de um contato migrado p/ **LID addressing**.
   *
   * A Evolution (v2.3.x) reescreve `remoteJid` p/ o telefone antes de postar o
   * webhook, então o adapter nunca recebe o `@lid` — mas **precisa** enviar a
   * resposta p/ o `@lid` (enviar p/ `<telefone>@s.whatsapp.net` não estabelece
   * sessão e a mensagem nunca entrega). O `@lid` fica preservado na `key` das
   * mensagens **recebidas** (a Evolution guarda `remoteJid: <lid>@lid`,
   * `remoteJidAlt: <telefone>@s.whatsapp.net`), que buscamos via `findMessages`:
   * - com `messageId` (resposta a um inbound): filtra pela própria `key.id` —
   *   correto por construção (é exatamente a mensagem que estamos respondendo);
   * - sem ele (envio proativo, ex.: lembrete): filtra por `remoteJidAlt`
   *   (telefone) e pega a mais recente do contato.
   * Resultado cacheado (LID é estável por contato). Best-effort: `null` se não
   * achar (o chamador cai p/ o telefone).
   */
  async resolveLidJid(
    instance: string,
    phoneJid: string,
    messageId?: string,
  ): Promise<string | null> {
    const cached = this.lidByPhoneJid.get(phoneJid);
    if (cached) return cached;
    try {
      const where = messageId
        ? { key: { id: messageId } }
        : { key: { remoteJidAlt: phoneJid } };
      const res = await this.post<{
        messages?: { records?: Array<{ key?: { remoteJid?: string } }> };
      }>(`/chat/findMessages/${instance}`, { where, limit: 1 });
      const lid = res?.messages?.records?.[0]?.key?.remoteJid;
      if (typeof lid === 'string' && lid.endsWith('@lid')) {
        this.lidByPhoneJid.set(phoneJid, lid);
        return lid;
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao resolver LID de ${phoneJid}: ${detail}`);
    }
    return null;
  }

  /**
   * Busca o base64 de uma mídia (áudio) quando o webhook não o incluiu.
   * Usa a `key` original da mensagem (a Evolution rebaixa do servidor).
   */
  async getMediaBase64(
    instance: string,
    messageKey: unknown,
  ): Promise<string | undefined> {
    const res = await this.post<{ base64?: string }>(
      `/chat/getBase64FromMediaMessage/${instance}`,
      { message: { key: messageKey }, convertToMp4: false },
    );
    return res?.base64;
  }

  // ─── Gestão de instâncias (F10 · pareamento por QR na tela) ───────────────
  //
  // Automatiza o que antes era um procedimento de terminal (docs/WHATSAPP.md
  // §3–4): criar a instância já apontando o webhook para cá e pedir o QR. É o
  // que tira o produto de "um número, uma clínica".

  /**
   * Cria a instância e **já aponta o webhook** para a nossa API. Fazer as duas
   * coisas numa chamada só evita o estado intermediário em que a instância
   * existe, o número é pareado e as mensagens não chegam a lugar nenhum.
   */
  async createInstance(
    instanceName: string,
    webhook: { url: string; token?: string },
  ): Promise<unknown> {
    return this.post('/instance/create', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        url: webhook.url,
        // Um endpoint único (sem o nome do evento colado na URL).
        byEvents: false,
        // Áudio embutido no webhook — evita uma 2ª chamada para buscar a mídia.
        base64: true,
        ...(webhook.token
          ? { headers: { 'x-evolution-token': webhook.token } }
          : {}),
        // Só o que o adapter consome.
        events: ['MESSAGES_UPSERT'],
      },
    });
  }

  /** Pede um QR novo para parear. O QR expira em segundos — repita à vontade. */
  async connectInstance(instanceName: string): Promise<unknown> {
    return this.request('GET', `/instance/connect/${instanceName}`);
  }

  /** Estado da sessão: `open` (conectado), `connecting`, `close`. */
  async connectionState(instanceName: string): Promise<unknown> {
    return this.request('GET', `/instance/connectionState/${instanceName}`);
  }

  /** Dados da instância (inclui o número pareado). Vazio = não existe. */
  async fetchInstance(instanceName: string): Promise<unknown> {
    return this.request(
      'GET',
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
    );
  }

  /** Desconecta o número, mantendo a instância. */
  async logoutInstance(instanceName: string): Promise<unknown> {
    return this.post(`/instance/logout/${instanceName}`, {});
  }

  /** Remove a instância por completo. */
  async deleteInstance(instanceName: string): Promise<unknown> {
    return this.request('DELETE', `/instance/delete/${instanceName}`);
  }

  private get baseUrl(): string | undefined {
    return this.config.get('EVOLUTION_API_URL', { infer: true });
  }

  private get apiKey(): string | undefined {
    return this.config.get('EVOLUTION_API_KEY', { infer: true });
  }

  /** Delay "digitando" (ms) proporcional ao texto, com leve aleatoriedade. */
  private typingDelay(text: string): number {
    const base = Math.min(
      Math.max(text.length * TYPING_MS_PER_CHAR, TYPING_MIN_MS),
      TYPING_MAX_MS,
    );
    return Math.round(base + Math.random() * 600);
  }

  private async post<T = unknown>(
    path: string,
    body: unknown,
  ): Promise<T | undefined> {
    return this.request<T>('POST', path, body);
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T | undefined> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error(
        'Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY).',
      );
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Evolution ${path} respondeu ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }
    // Algumas rotas devolvem corpo vazio — toleramos.
    return (await res.json().catch(() => undefined)) as T | undefined;
  }
}
