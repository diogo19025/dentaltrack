import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AgendaModule } from '../agenda/agenda.module';
import { AutomationsModule } from '../automations/automations.module';
import { AgendaJobs } from './agenda.jobs';
import { MetricsJobs } from './metrics.jobs';

/**
 * Jobs agendados. Registra o scheduler (`@nestjs/schedule`), o `MetricsJobs`
 * (abandono por inatividade + agregação diária, BE-3.4) e o `AgendaJobs`
 * (sincronização da agenda + planejamento/despacho das automações, F9).
 */
@Module({
  imports: [ScheduleModule.forRoot(), AgendaModule, AutomationsModule],
  providers: [MetricsJobs, AgendaJobs],
  exports: [MetricsJobs, AgendaJobs],
})
export class JobsModule {}
