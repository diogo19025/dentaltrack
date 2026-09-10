import { Module } from '@nestjs/common';
import { EvolutionService } from './evolution.service';

/**
 * Transporte compartilhado da Evolution, separado do adapter de entrada.
 * Automations usa a saída e WhatsappService usa a fila; este módulo pequeno
 * evita transformar essa relação legítima num ciclo entre módulos NestJS.
 */
@Module({
  providers: [EvolutionService],
  exports: [EvolutionService],
})
export class WhatsappTransportModule {}
