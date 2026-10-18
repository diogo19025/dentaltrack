import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  saveMetaCredentialsSchema,
  type MetaConnection,
} from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TenantGuard } from '../auth/tenant.guard';
import { MetaConnectionService } from './meta-connection.service';

export class SaveMetaCredentialsDto extends createZodDto(
  saveMetaCredentialsSchema,
) {}

/**
 * Credenciais da Cloud API da Meta da empresa. Só o dono: o token dá acesso ao
 * número da empresa. O `clinicId` vem do token de login, nunca do corpo.
 */
@Controller('whatsapp/meta/connection')
@UseGuards(TenantGuard, RolesGuard)
@Roles('owner')
export class MetaConnectionController {
  constructor(private readonly meta: MetaConnectionService) {}

  @Get()
  status(@ClinicId() clinicId: string): Promise<MetaConnection> {
    return this.meta.getStatus(clinicId);
  }

  @Put()
  save(
    @ClinicId() clinicId: string,
    @Body() body: SaveMetaCredentialsDto,
  ): Promise<MetaConnection> {
    return this.meta.save(clinicId, body);
  }

  @Delete()
  remove(@ClinicId() clinicId: string): Promise<MetaConnection> {
    return this.meta.remove(clinicId);
  }
}
