import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MetricsJobs } from './metrics.jobs';

/**
 * Jobs agendados (BE-3.4). Registra o scheduler (`@nestjs/schedule`) e o
 * `MetricsJobs` (abandono por inatividade + agregação diária).
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [MetricsJobs],
  exports: [MetricsJobs],
})
export class JobsModule {}
