import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  CreateProfessionalInput,
  ExternalProfessional,
  ProfessionalDto,
  UpdateProfessionalInput,
} from '@dentaltrack/shared';
import type { Professional } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Profissionais da empresa (F20) — o espelho local de quem atende.
 *
 * A agenda do sistema de gestão é por profissional, e a conta real tem dez. O
 * produto só conhecia o profissional padrão único da integração, e o nome que
 * chegava pela sincronização era texto solto em `appointment`. Sem uma tabela
 * por trás não dá para filtrar a agenda por profissional, nem colorir por
 * pessoa, nem deixar o cliente escolher com quem marcar.
 *
 * **Espelho, não fonte:** quem some da conta do cliente é desativado, nunca
 * apagado, porque os agendamentos passados apontam para ele.
 */
@Injectable()
export class ProfessionalsService {
  private readonly logger = new Logger(ProfessionalsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Profissionais da empresa. Ordem de entrada e não alfabética de propósito:
   * é dela que a tela deriva a cor de cada um, e ordenar por nome faria a cor
   * de todo mundo mudar quando entrasse uma "Ana".
   */
  async list(
    clinicId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<ProfessionalDto[]> {
    const rows = await this.prisma.professional.findMany({
      where: {
        clinicId,
        ...(options.includeInactive ? {} : { active: true }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  /** Só os ativos, para quem precisa decidir (agente, agendamento). */
  listActive(clinicId: string): Promise<ProfessionalDto[]> {
    return this.list(clinicId, { includeInactive: false });
  }

  async create(
    clinicId: string,
    input: CreateProfessionalInput,
  ): Promise<ProfessionalDto> {
    const row = await this.prisma.professional.create({
      data: { clinicId, name: input.name },
    });
    return toDto(row);
  }

  async update(
    clinicId: string,
    id: string,
    input: UpdateProfessionalInput,
  ): Promise<ProfessionalDto> {
    await this.ensureExists(clinicId, id);
    const row = await this.prisma.professional.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
    });
    return toDto(row);
  }

  /**
   * Remover é desativar quando o profissional veio do sistema de gestão: a
   * próxima sincronização o traria de volta, e apagar quebraria os
   * agendamentos que apontam para ele. Só o cadastro manual sem histórico
   * some de verdade.
   */
  async remove(clinicId: string, id: string): Promise<{ id: string }> {
    const row = await this.ensureExists(clinicId, id);
    const appointments = await this.prisma.appointment.count({
      where: { professionalId: id },
    });

    if (row.externalId || appointments > 0) {
      await this.prisma.professional.update({
        where: { id },
        data: { active: false },
      });
      return { id };
    }

    await this.prisma.professional.delete({ where: { id } });
    return { id };
  }

  /**
   * Reconcilia o cadastro com o que o sistema de gestão devolveu.
   *
   * Chamado pela verificação de conexão e pela sincronização da agenda. Quem
   * chega é criado ou reativado; quem sumiu vira `active = false`.
   *
   * **A lista vazia não desativa ninguém.** Uma resposta transitoriamente
   * vazia do fornecedor — que é exatamente o que `readList` produz quando o
   * formato diverge, por desenho — apagaria a equipe inteira da tela e faria o
   * agente parar de oferecer qualquer profissional. Na dúvida, não mexe.
   */
  async syncFromProvider(
    clinicId: string,
    external: readonly ExternalProfessional[],
  ): Promise<{ criados: number; atualizados: number; desativados: number }> {
    if (external.length === 0) {
      this.logger.warn(
        `O provedor não devolveu nenhum profissional para a empresa ${clinicId}; o cadastro fica como está.`,
      );
      return { criados: 0, atualizados: 0, desativados: 0 };
    }

    const existing = await this.prisma.professional.findMany({
      where: { clinicId, externalId: { not: null } },
    });
    const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

    let criados = 0;
    let atualizados = 0;

    for (const person of external) {
      const current = byExternalId.get(person.id);
      if (!current) {
        await this.prisma.professional.create({
          data: {
            clinicId,
            externalId: person.id,
            name: person.name,
            unitExternalId: person.unitId,
            active: true,
          },
        });
        criados += 1;
        continue;
      }

      // Renomear no painel do cliente é comum; reativar quem voltou também.
      if (
        current.name !== person.name ||
        current.unitExternalId !== person.unitId ||
        !current.active
      ) {
        await this.prisma.professional.update({
          where: { id: current.id },
          data: {
            name: person.name,
            unitExternalId: person.unitId,
            active: true,
          },
        });
        atualizados += 1;
      }
    }

    const arrived = new Set(external.map((person) => person.id));
    const gone = existing.filter(
      (row) => row.active && row.externalId && !arrived.has(row.externalId),
    );
    if (gone.length > 0) {
      await this.prisma.professional.updateMany({
        where: { id: { in: gone.map((row) => row.id) } },
        data: { active: false },
      });
    }

    return { criados, atualizados, desativados: gone.length };
  }

  private async ensureExists(
    clinicId: string,
    id: string,
  ): Promise<Professional> {
    const row = await this.prisma.professional.findFirst({
      where: { id, clinicId },
    });
    if (!row) throw new NotFoundException('Profissional não encontrado.');
    return row;
  }
}

function toDto(row: Professional): ProfessionalDto {
  return {
    id: row.id,
    externalId: row.externalId ?? '',
    name: row.name,
    active: row.active,
    unitExternalId: row.unitExternalId ?? '',
    createdAt: row.createdAt.toISOString(),
  };
}
