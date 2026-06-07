import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateProcedureInput, UpdateProcedureInput } from "@dentaltrack/shared";
import type { Procedure } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Catálogo de procedimentos (BE-2.2). CRUD sempre escopado por `clinicId`
 * (multi-tenant). Alimenta as tools do agente (`searchProcedures`) e o system
 * prompt (BE-1.3). Ver docs/plan.md §5.
 */
@Injectable()
export class ProceduresService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista os procedimentos da clínica (ordem alfabética). */
  list(clinicId: string): Promise<Procedure[]> {
    return this.prisma.procedure.findMany({ where: { clinicId }, orderBy: { name: "asc" } });
  }

  /** Cria um procedimento na clínica. */
  create(clinicId: string, input: CreateProcedureInput): Promise<Procedure> {
    return this.prisma.procedure.create({ data: { clinicId, ...input } });
  }

  /** Atualiza um procedimento da clínica (404 se não pertencer ao tenant). */
  async update(clinicId: string, id: string, input: UpdateProcedureInput): Promise<Procedure> {
    await this.ensureExists(clinicId, id);
    return this.prisma.procedure.update({ where: { id }, data: input });
  }

  /** Remove um procedimento da clínica (404 se não pertencer ao tenant). */
  async remove(clinicId: string, id: string): Promise<{ id: string }> {
    await this.ensureExists(clinicId, id);
    await this.prisma.procedure.delete({ where: { id } });
    return { id };
  }

  /** Garante que o procedimento existe e pertence à clínica do tenant. */
  private async ensureExists(clinicId: string, id: string): Promise<void> {
    const found = await this.prisma.procedure.findFirst({
      where: { id, clinicId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Procedimento ${id} não encontrado.`);
  }
}
