import { Module } from '@nestjs/common';
import { EvolutionService } from './evolution.service';
import { WhatsappTransportResolver } from './transport/whatsapp-transport.resolver';

/**
 * Transporte compartilhado do WhatsApp, separado do adapter de entrada.
 * Automations usa a saída e WhatsappService usa a fila; este módulo pequeno
 * evita transformar essa relação legítima num ciclo entre módulos NestJS.
 *
 * Quem envia usa o `WhatsappTransportResolver` (porta, independente do
 * provedor). O `EvolutionService` continua exportado para o que é da Evolution
 * por natureza: o pareamento por QR (F10) e o health.
 */
@Module({
  providers: [EvolutionService, WhatsappTransportResolver],
  exports: [EvolutionService, WhatsappTransportResolver],
})
export class WhatsappTransportModule {}
