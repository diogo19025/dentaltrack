import { Injectable } from '@nestjs/common';
import { EvolutionService } from '../evolution.service';
import { EvolutionTransport } from './evolution.transport';
import type { WhatsappTransport } from './whatsapp-transport';

/** O que o resolvedor precisa saber da empresa — já carregado por quem chama. */
export interface WhatsappAccountSettings {
  whatsappInstance: string | null;
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
  constructor(private readonly evolution: EvolutionService) {}

  /** Transporte da empresa, ou `null` se o WhatsApp não está configurado. */
  forSettings(
    settings: WhatsappAccountSettings | null | undefined,
  ): WhatsappTransport | null {
    const instance = settings?.whatsappInstance;
    if (!instance || !this.evolution.isConfigured()) return null;
    return new EvolutionTransport(this.evolution, instance);
  }

  /**
   * Transporte de uma instância Evolution conhecida — a entrada pelo webhook,
   * que já chega identificada pela instância e é específica desse provedor.
   */
  forEvolutionInstance(instance: string): WhatsappTransport {
    return new EvolutionTransport(this.evolution, instance);
  }
}
