import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Módulo de onboarding (provisionamento de empresa + membership no 1º acesso).
 * Usa o PrismaService (global). Ver OnboardingService.
 */
@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
