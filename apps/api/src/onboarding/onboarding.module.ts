import { Module } from '@nestjs/common';
import { ClinicorpModule } from '../clinicorp/clinicorp.module';
import { OnboardingChecklistService } from './onboarding-checklist.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Módulo de onboarding: provisionamento de empresa + membership no 1º acesso
 * (`OnboardingService`) e o checklist derivado do que falta configurar
 * (`OnboardingChecklistService`, P1.1). Usa o PrismaService (global).
 */
@Module({
  imports: [ClinicorpModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingChecklistService],
})
export class OnboardingModule {}
