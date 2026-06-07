import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import type { ClinicSettingsDto } from "@dentaltrack/shared";
import { ClinicId } from "../auth/clinic-id.decorator";
import { TenantGuard } from "../auth/tenant.guard";
import { UpdateSettingsDto } from "./dto";
import { SettingsService } from "./settings.service";

/**
 * Configurações do bot (BE-2.1). Protegido: SupabaseJwtGuard (global) + o
 * TenantGuard resolve o `clinicId` do usuário. Alimenta o system prompt
 * (BE-1.3) e a tela `/settings` (FE-2.*).
 */
@Controller("settings")
@UseGuards(TenantGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@ClinicId() clinicId: string): Promise<ClinicSettingsDto> {
    return this.settings.getSettings(clinicId);
  }

  @Patch()
  update(
    @ClinicId() clinicId: string,
    @Body() body: UpdateSettingsDto,
  ): Promise<ClinicSettingsDto> {
    return this.settings.updateSettings(clinicId, body);
  }
}
