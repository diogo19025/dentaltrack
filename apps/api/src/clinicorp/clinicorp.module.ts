import { Module } from '@nestjs/common';
import { ProfessionalsModule } from '../professionals/professionals.module';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';

/**
 * Integração com o sistema de gestão da empresa (F9 · hoje Clinicorp).
 *
 * Exporta só o `IntegrationService`: quem precisa da agenda pede um
 * `AgendaProvider` por empresa e nunca conhece o fornecedor. PrismaService vem
 * do PrismaModule global.
 */
@Module({
  imports: [ProfessionalsModule],
  controllers: [IntegrationController],
  providers: [IntegrationService],
  exports: [IntegrationService],
})
export class ClinicorpModule {}
