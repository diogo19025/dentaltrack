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
 * e uma `membership` (owner). **Idempotente** — se já existir membership, devolve
 * a clínica atual sem criar nada. Fecha o buraco de "usuário novo sem clínica"
 * (antes era preciso inserir a membership na mão).
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureClinic(input: EnsureClinicInput): Promise<EnsureClinicResult> {
    const existing = await this.prisma.membership.findFirst({
      where: { userId: input.userId },
      orderBy: { createdAt: "asc" },
      select: { clinicId: true },
    });
    if (existing) return { clinicId: existing.clinicId, created: false };

    const name = input.clinicName?.trim() || "Minha clínica";
    // Cria clínica + vínculo (owner) atomicamente.
    const clinic = await this.prisma.$transaction(async (tx) => {
      const created = await tx.clinic.create({ data: { name } });
      await tx.membership.create({ data: { userId: input.userId, clinicId: created.id } });
      return created;
    });

    this.logger.log(`Clínica provisionada para o usuário ${input.userId}: ${clinic.id}`);
    return { clinicId: clinic.id, created: true };
  }
}
