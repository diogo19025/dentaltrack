import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { ConnectionCheck, IntegrationStatus } from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { UpdateIntegrationDto } from './dto';
import { IntegrationService } from './integration.service';

/**
 * Integração com o sistema de gestão da empresa (F9).
 *
 * `GET` devolve o estado **sem nenhum segredo**; `PUT` salva (credencial
 * omitida mantém a guardada); `POST /check` roda a verificação só-leitura.
 * Protegido por SupabaseJwtGuard (global) + TenantGuard — o `clinicId` vem do
 * token, nunca do corpo.
 */
@Controller('integrations/clinicorp')
@UseGuards(TenantGuard)
export class IntegrationController {
  constructor(private readonly integrations: IntegrationService) {}

  @Get()
  status(@ClinicId() clinicId: string): Promise<IntegrationStatus> {
    return this.integrations.getStatus(clinicId);
  }

  @Put()
  update(
    @ClinicId() clinicId: string,
    @Body() body: UpdateIntegrationDto,
  ): Promise<IntegrationStatus> {
    return this.integrations.update(clinicId, body);
  }

  @Post('check')
  @HttpCode(200)
  check(@ClinicId() clinicId: string): Promise<ConnectionCheck> {
    return this.integrations.check(clinicId);
  }
}
