import { Module } from '@nestjs/common';
import { ClinicorpModule } from '../clinicorp/clinicorp.module';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';
import { AgendaSyncService } from './agenda-sync.service';

/**
 * Agenda (F9) — disponibilidade, agendamento e sincronização com o sistema de
 * gestão. Importa o `ClinicorpModule` só para obter o `AgendaProvider` da
 * empresa; nada aqui conhece o fornecedor. Exporta os dois serviços porque o
 * motor do agente (tools) e o cron dependem deles.
 */
@Module({
  imports: [ClinicorpModule],
  controllers: [AgendaController],
  providers: [AgendaService, AgendaSyncService],
  exports: [AgendaService, AgendaSyncService],
})
export class AgendaModule {}
