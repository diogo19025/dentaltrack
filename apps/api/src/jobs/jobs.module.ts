import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AgendaModule } from '../agenda/agenda.module';
import { AutomationsModule } from '../automations/automations.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AgendaJobs } from './agenda.jobs';
import { MetricsJobs } from './metrics.jobs';
import { WhatsappJobs } from './whatsapp.jobs';

/**
 * Jobs agendados. Registra o scheduler (`@nestjs/schedule`), o `MetricsJobs`
 * (abandono por inatividade + agregação diária, BE-3.4) e o `AgendaJobs`
 * (sincronização da agenda + planejamento/despacho das automações, F9).
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    AgendaModule,
    AutomationsModule,
    WhatsappModule,
  ],
  providers: [MetricsJobs, AgendaJobs, WhatsappJobs],
  exports: [MetricsJobs, AgendaJobs, WhatsappJobs],
})
export class JobsModule {}
