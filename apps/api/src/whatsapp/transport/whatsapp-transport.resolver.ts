import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptSecret,
  loadEncryptionKey,
} from '../../clinicorp/credentials-crypto';
import type { Env } from '../../config/env.validation';
import { EvolutionService } from '../evolution.service';
import { EvolutionTransport } from './evolution.transport';
import { MetaTransport } from './meta.transport';
import type { WhatsappTransport } from './whatsapp-transport';

/** O que o resolvedor precisa saber da empresa — já carregado por quem chama. */
export interface WhatsappAccountSettings {
  whatsappInstance: string | null;
  /** `meta` usa a Cloud API; qualquer outro valor (ou ausente) é a Evolution. */
  whatsappProvider?: string | null;
  metaPhoneNumberId?: string | null;
  metaAccessTokenEnc?: string | null;
}

/**
 * Escolhe o transporte de WhatsApp da empresa. Hoje só existe a Evolution; o
 * provedor oficial entra aqui, sem que quem envia mude.
 *
 * Recebe as configurações já lidas em vez de consultá-las: todos os chamadores
 * já leem `clinicSettings` para as próprias decisões, e uma segunda consulta
 * por mensagem na fila não compraria nada.
 */
@Injectable()
export class WhatsappTransportResolver {
  private readonly logger = new Logger(WhatsappTransportResolver.name);

  constructor(
    private readonly evolution: EvolutionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Transporte da empresa, ou `null` se o WhatsApp não está configurado. */
  forSettings(
    settings: WhatsappAccountSettings | null | undefined,
  ): WhatsappTransport | null {
    if (settings?.whatsappProvider === 'meta') return this.forMeta(settings);
    const instance = settings?.whatsappInstance;
    if (!instance || !this.evolution.isConfigured()) return null;
    return new EvolutionTransport(this.evolution, instance);
  }

  /**
   * Transporte da Cloud API da empresa, ou `null` sem credencial salva ou com a
   * chave de cifra ausente/errada (falha fechada, com o motivo no log).
   */
  forMeta(
    settings: WhatsappAccountSettings | null | undefined,
  ): WhatsappTransport | null {
    if (!settings?.metaPhoneNumberId || !settings.metaAccessTokenEnc) {
      return null;
    }
    try {
      const token = decryptSecret(
        settings.metaAccessTokenEnc,
        loadEncryptionKey(
          this.config.get('INTEGRATION_ENCRYPTION_KEY', { infer: true }),
        ),
      );
      return new MetaTransport(
        settings.metaPhoneNumberId,
        token,
        this.config.get('META_GRAPH_VERSION', { infer: true }),
      );
    } catch (err) {
      this.logger.error(
        `Token da Meta ilegível para o número ${settings.metaPhoneNumberId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Transporte de uma instância Evolution conhecida — a entrada pelo webhook,
   * que já chega identificada pela instância e é específica desse provedor.
   */
  forEvolutionInstance(instance: string): WhatsappTransport {
    return new EvolutionTransport(this.evolution, instance);
  }
}
