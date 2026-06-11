import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import type { LeadDetail, LeadsResponse } from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { LeadsService } from './leads.service';

/**
 * GET /leads (F3 · FE-3.6) — leads capturados + resumo. `GET /leads/:id` →
 * detalhe expandido (conversas + agendamentos) p/ o painel do dashboard.
 * Protegido pelo SupabaseJwtGuard (global) + TenantGuard (resolve o `clinicId`).
 */
@Controller('leads')
@UseGuards(TenantGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(@ClinicId() clinicId: string): Promise<LeadsResponse> {
    return this.leads.list(clinicId);
  }

  @Get(':id')
  detail(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadDetail> {
    return this.leads.detail(clinicId, id);
  }
}
