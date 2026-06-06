import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface EnsureClinicInput {
  userId: string;
  email?: string;
  clinicName?: string;
}

export interface EnsureClinicResult {
  clinicId: string;
  created: boolean;
}

/**
 * Onboarding multi-tenant: garante que o usuário autenticado tenha uma clínica
 * e uma `membership` (owner). **Idempotente e seguro sob concorrência** — o
 * layout pode disparar o bootstrap em renders simultâneos (ex.: fluxo OAuth),
 * então usamos um advisory lock por usuário para não criar clínica duplicada.
 * Fecha o buraco de "usuário novo sem clínica".
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureClinic(input: EnsureClinicInput): Promise<EnsureClinicResult> {
    // Caminho rápido (sem lock): o caso comum é já existir.
    const existing = await this.prisma.membership.findFirst({
      where: { userId: input.userId },
      orderBy: { createdAt: "asc" },
      select: { clinicId: true },
    });
    if (existing) return { clinicId: existing.clinicId, created: false };

    const name = input.clinicName?.trim() || "Minha clínica";

    return this.prisma.$transaction(async (tx) => {
      // Lock por usuário (transaction-scoped): chamadas concorrentes do mesmo
      // usuário serializam aqui, evitando provisionar duas clínicas.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`;

      // Re-checa dentro do lock: outra chamada pode ter provisionado enquanto
      // esperávamos o lock.
      const concurrent = await tx.membership.findFirst({
        where: { userId: input.userId },
        orderBy: { createdAt: "asc" },
        select: { clinicId: true },
      });
      if (concurrent) return { clinicId: concurrent.clinicId, created: false };

      const clinic = await tx.clinic.create({ data: { name } });
      await tx.membership.create({ data: { userId: input.userId, clinicId: clinic.id } });
      this.logger.log(`Clínica provisionada para o usuário ${input.userId}: ${clinic.id}`);
      return { clinicId: clinic.id, created: true };
    });
  }
}
