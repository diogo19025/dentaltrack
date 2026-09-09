import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { HealthController } from './health.controller';

/** WhatsappModule entra só pelo `EvolutionService.isConfigured()` — evita duplicar
 * aqui a regra de "o transporte está configurado?", que já mora nele. */
@Module({
  imports: [WhatsappModule],
  controllers: [HealthController],
})
export class HealthModule {}
