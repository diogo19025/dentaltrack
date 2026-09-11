import { Injectable, Logger } from '@nestjs/common';
import type { OnboardingBootstrap } from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface EnsureClinicInput {
  userId: string;
  email?: string;
  clinicName?: string;
}

export type EnsureClinicResult = OnboardingBootstrap;

/**
 * Onboarding multi-tenant: garante que o usuário autenticado tenha uma empresa
 * e uma `membership` (owner). **Idempotente e seguro sob concorrência** — o
 * layout pode disparar o bootstrap em renders simultâneos (ex.: fluxo OAuth),
 * então usamos um advisory lock por usuário para não criar empresa duplicada.
 * Fecha o buraco de "usuário novo sem empresa".
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureClinic(input: EnsureClinicInput): Promise<EnsureClinicResult> {
    // Caminho rápido (sem lock): o caso comum é já existir.
    const existing = await this.prisma.membership.findFirst({
      where: { userId: input.userId },
      orderBy: { createdAt: 'asc' },
      select: { clinicId: true, role: true },
    });
    if (existing) return { ...existing, created: false };

    const name = input.clinicName?.trim() || 'Minha empresa';

    return this.prisma.$transaction(async (tx) => {
      // Lock por usuário (transaction-scoped): chamadas concorrentes do mesmo
      // usuário serializam aqui, evitando provisionar duas empresas.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`;

      // Re-checa dentro do lock: outra chamada pode ter provisionado enquanto
      // esperávamos o lock.
      const concurrent = await tx.membership.findFirst({
        where: { userId: input.userId },
        orderBy: { createdAt: 'asc' },
        select: { clinicId: true, role: true },
      });
      if (concurrent) return { ...concurrent, created: false };

      const clinic = await tx.clinic.create({ data: { name } });
      await tx.membership.create({
        data: { userId: input.userId, clinicId: clinic.id, role: 'owner' },
      });
      this.logger.log(
        `Empresa provisionada para o usuário ${input.userId}: ${clinic.id}`,
      );
      return { clinicId: clinic.id, created: true, role: 'owner' };
    });
  }
}
