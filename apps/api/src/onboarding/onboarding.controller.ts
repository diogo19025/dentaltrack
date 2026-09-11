import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { OnboardingChecklistDto } from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import type { AuthUser } from '../auth/types';
import { OnboardingChecklistService } from './onboarding-checklist.service';
import {
  type EnsureClinicResult,
  OnboardingService,
} from './onboarding.service';

@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly checklist: OnboardingChecklistService,
  ) {}

  /**
   * POST /onboarding/bootstrap — idempotente. Garante empresa + membership do
   * usuário autenticado (protegido pelo SupabaseJwtGuard global). **Sem
   * TenantGuard** de propósito: é justamente o passo que cria o tenant. O nome
   * da empresa vem do `clinic_name` enviado no signup (metadata do JWT).
   */
  @Post('bootstrap')
  bootstrap(@CurrentUser() user: AuthUser): Promise<EnsureClinicResult> {
    const meta = user.raw.user_metadata as
      | { clinic_name?: unknown }
      | undefined;
    const clinicName =
      typeof meta?.clinic_name === 'string' ? meta.clinic_name : undefined;
    return this.onboarding.ensureClinic({
      userId: user.id,
      email: user.email,
      clinicName,
    });
  }

  /**
   * GET /onboarding/checklist — o que falta configurar, derivado do estado
   * real das tabelas (P1.1). Sob TenantGuard: aqui o tenant já existe.
   */
  @Get('checklist')
  @UseGuards(TenantGuard)
  getChecklist(@ClinicId() clinicId: string): Promise<OnboardingChecklistDto> {
    return this.checklist.getChecklist(clinicId);
  }
}
