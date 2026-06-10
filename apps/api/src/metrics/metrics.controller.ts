import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { type MetricsDto, metricsRangeSchema } from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { MetricsService } from './metrics.service';

/**
 * GET /metrics?range= (BE-3.3) — KPIs + séries do dashboard. Protegido pelo
 * SupabaseJwtGuard (global) + TenantGuard (resolve o `clinicId`). `range`
 * inválido cai no default 50d (requisito do produto).
 */
@Controller('metrics')
@UseGuards(TenantGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  get(
    @ClinicId() clinicId: string,
    @Query('range') range?: string,
  ): Promise<MetricsDto> {
    const parsed = metricsRangeSchema.catch('50d').parse(range);
    return this.metrics.getMetrics(clinicId, parsed);
  }
}
