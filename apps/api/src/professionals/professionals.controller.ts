import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ProfessionalsResponse } from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateProfessionalDto, UpdateProfessionalDto } from './dto';
import { ProfessionalsService } from './professionals.service';

/**
 * Profissionais da empresa (F20).
 *
 * A **leitura** fica aberta ao staff: a agenda filtra e colore por
 * profissional, e quem atende no balcão precisa disso. Só a escrita é do dono,
 * como nas demais superfícies administrativas (P1.4).
 */
@Controller('professionals')
@UseGuards(TenantGuard, RolesGuard)
export class ProfessionalsController {
  constructor(private readonly professionals: ProfessionalsService) {}

  @Get()
  async list(
    @ClinicId() clinicId: string,
    @Query('incluirInativos') includeInactive?: string,
  ): Promise<ProfessionalsResponse> {
    const professionals = await this.professionals.list(clinicId, {
      includeInactive: includeInactive === 'true',
    });
    return { professionals };
  }

  @Post()
  @Roles('owner')
  create(@ClinicId() clinicId: string, @Body() body: CreateProfessionalDto) {
    return this.professionals.create(clinicId, body);
  }

  @Patch(':id')
  @Roles('owner')
  update(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProfessionalDto,
  ) {
    return this.professionals.update(clinicId, id, body);
  }

  @Delete(':id')
  @Roles('owner')
  remove(
    @ClinicId() clinicId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.professionals.remove(clinicId, id);
  }
}
