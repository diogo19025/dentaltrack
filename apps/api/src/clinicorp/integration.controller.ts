import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  type PipeTransform,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  type ConnectionCheck,
  type IntegrationProvider,
  type IntegrationStatus,
  integrationProviderSchema,
} from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateIntegrationDto } from './dto';
import { IntegrationService } from './integration.service';

/** Valida o `:provider` da rota (clinicorp | google). */
@Injectable()
export class IntegrationProviderPipe implements PipeTransform<
  string,
  IntegrationProvider
> {
  transform(value: string): IntegrationProvider {
    const parsed = integrationProviderSchema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException(
        `Provedor de agenda desconhecido: ${value}`,
      );
    }
    return parsed.data;
  }
}

/**
 * Integração de agenda da empresa (F9 · Clinicorp; F12 · Google Agenda).
 *
 * Rotas por provedor (`/integrations/clinicorp`, `/integrations/google`).
 * `GET` devolve o estado **sem nenhum segredo**; `PUT` salva (credencial
 * omitida mantém a guardada; ligar um provedor desliga o outro); `POST /check`
 * roda a verificação só-leitura. Protegido por SupabaseJwtGuard (global) +
 * TenantGuard — o `clinicId` vem do token, nunca do corpo.
 */
@Controller('integrations')
@UseGuards(TenantGuard, RolesGuard)
@Roles('owner')
export class IntegrationController {
  constructor(private readonly integrations: IntegrationService) {}

  @Get(':provider')
  status(
    @ClinicId() clinicId: string,
    @Param('provider', IntegrationProviderPipe) provider: IntegrationProvider,
  ): Promise<IntegrationStatus> {
    return this.integrations.getStatus(clinicId, provider);
  }

  @Put(':provider')
  update(
    @ClinicId() clinicId: string,
    @Param('provider', IntegrationProviderPipe) provider: IntegrationProvider,
    @Body() body: UpdateIntegrationDto,
  ): Promise<IntegrationStatus> {
    return this.integrations.update(clinicId, provider, body);
  }

  @Post(':provider/check')
  @HttpCode(200)
  check(
    @ClinicId() clinicId: string,
    @Param('provider', IntegrationProviderPipe) provider: IntegrationProvider,
  ): Promise<ConnectionCheck> {
    return this.integrations.check(clinicId, provider);
  }
}
