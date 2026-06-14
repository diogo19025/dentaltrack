import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** A Evolution está configurada? (sem URL/chave o WhatsApp fica inativo.) */
  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /**
   * Envia uma mensagem de texto. Aplica um `delay` (indicador "digitando")
   * proporcional ao tamanho do texto — higiene anti-ban (WA-4), respostas
   * instantâneas parecem robô e aumentam risco de banimento.
   */
  async sendText(instance: string, phone: string, text: string): Promise<void> {
    const delay = this.typingDelay(text);
    await this.post(`/message/sendText/${instance}`, {
      number: phone,
      text,
      delay,
    });
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
    if (!this.baseUrl || !this.apiKey) {
      throw new Error(
        'Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY).',
      );
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
      },
      body: JSON.stringify(body),
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
