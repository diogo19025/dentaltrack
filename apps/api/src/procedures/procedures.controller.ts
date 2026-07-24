import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { ProcedureDto } from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { CreateProcedureDto, UpdateProcedureDto } from './dto';
import { ProceduresService } from './procedures.service';

/**
 * CRUD do catálogo de procedimentos (BE-2.2). Protegido: SupabaseJwtGuard
 * (global) + TenantGuard resolve o `clinicId`. Toda operação é escopada por
 * empresa — o `clinicId` nunca vem do cliente.
 */
@Controller('procedures')
@UseGuards(TenantGuard)
export class ProceduresController {
  constructor(private readonly procedures: ProceduresService) {}

  @Get()
  list(@ClinicId() clinicId: string): Promise<ProcedureDto[]> {
    return this.procedures.list(clinicId);
  }

  @Post()
  create(
    @ClinicId() clinicId: string,
    @Body() body: CreateProcedureDto,
  ): Promise<ProcedureDto> {
    return this.procedures.create(clinicId, body);
  }

  @Patch(':id')
  update(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProcedureDto,
  ): Promise<ProcedureDto> {
    return this.procedures.update(clinicId, id, body);
  }

  @Delete(':id')
  remove(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.procedures.remove(clinicId, id);
  }
}
