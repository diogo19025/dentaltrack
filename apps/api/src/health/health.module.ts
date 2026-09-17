import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { WhatsappTransportModule } from '../whatsapp/whatsapp-transport.module';
import { HealthController } from './health.controller';

/**
 * O transporte entra só pelo `EvolutionService.isConfigured()` — evita duplicar
 * aqui a regra de "o transporte está configurado?", que já mora nele. É o
 * `WhatsappTransportModule` (e não o `WhatsappModule`) porque é ele quem
 * exporta o `EvolutionService`; importar o adapter inteiro não o traria e a
 * API não subia (`health.module.spec.ts` guarda isso).
 *
 * O `MediaModule` entra pelo mesmo motivo e da mesma forma: só pelo
 * `isConfigured()`, sem nenhuma chamada externa no healthcheck.
 */
@Module({
  imports: [WhatsappTransportModule, MediaModule],
  controllers: [HealthController],
})
export class HealthModule {}
