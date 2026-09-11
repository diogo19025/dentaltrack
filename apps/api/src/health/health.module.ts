import { Module } from '@nestjs/common';
import { WhatsappTransportModule } from '../whatsapp/whatsapp-transport.module';
import { HealthController } from './health.controller';

/**
 * O transporte entra só pelo `EvolutionService.isConfigured()` — evita duplicar
 * aqui a regra de "o transporte está configurado?", que já mora nele. É o
 * `WhatsappTransportModule` (e não o `WhatsappModule`) porque é ele quem
 * exporta o `EvolutionService`; importar o adapter inteiro não o traria e a
 * API não subia (`health.module.spec.ts` guarda isso).
 */
@Module({
  imports: [WhatsappTransportModule],
  controllers: [HealthController],
})
export class HealthModule {}
