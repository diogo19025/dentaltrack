import { Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/types';
import {
  type EnsureClinicResult,
  OnboardingService,
} from './onboarding.service';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /**
   * POST /onboarding/bootstrap — idempotente. Garante clínica + membership do
   * usuário autenticado (protegido pelo SupabaseJwtGuard global). **Sem
   * TenantGuard** de propósito: é justamente o passo que cria o tenant. O nome
   * da clínica vem do `clinic_name` enviado no signup (metadata do JWT).
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
}
