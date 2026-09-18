import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateProcedureInput,
  type ImportProceduresResult,
  MEDIA_TYPES,
  type MediaType,
  type ProcedureDto,
  type UpdateProcedureInput,
} from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Procedimento com as tags associadas (só os ids) — base do `ProcedureDto`. */
interface ProcedureRow {
  id: string;
  name: string;
  description: string | null;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  durationMinutes: number | null;
  active: boolean;
  offerText: string | null;
  offerMediaUrl: string | null;
  offerMediaType: string | null;
  tags: { id: string }[];
}

/** Inclui as tags associadas (só o id) em toda leitura/escrita. */
const WITH_TAGS = { tags: { select: { id: true } } } as const;

/** Valida o tipo de mídia salvo (string livre no banco) → MediaType | null. */
function normalizeMediaType(value: string | null): MediaType | null {
  return value && (MEDIA_TYPES as readonly string[]).includes(value)
    ? (value as MediaType)
    : null;
}

/** Linha do banco → DTO público (sem clinicId/timestamps; tags como ids). */
function toDto(row: ProcedureRow): ProcedureDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceMinCents: row.priceMinCents,
    priceMaxCents: row.priceMaxCents,
    durationMinutes: row.durationMinutes,
    active: row.active,
    offerText: row.offerText,
    offerMediaUrl: row.offerMediaUrl,
    offerMediaType: normalizeMediaType(row.offerMediaType),
    tagIds: row.tags.map((t) => t.id),
  };
}

/** Nome comparável: sem caixa, sem acento e sem espaço repetido. */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Catálogo de procedimentos (BE-2.2). CRUD sempre escopado por `clinicId`
 * (multi-tenant). Cada procedimento pode ter tags de interesse associadas
 * (relação N:N) — alimenta as tools do agente (`suggestProcedures`) e o system
 * prompt (BE-1.3). Ver docs/produto.md § Modelo de dados.
 */
@Injectable()
export class ProceduresService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista os procedimentos da empresa (ordem alfabética), com as tags. */
  async list(clinicId: string): Promise<ProcedureDto[]> {
    const rows = await this.prisma.procedure.findMany({
      where: { clinicId },
      orderBy: { name: 'asc' },
      include: WITH_TAGS,
    });
    return rows.map(toDto);
  }

  /**
   * Traz o catálogo do sistema de gestão (F20).
   *
   * Só cria o que falta, comparando por nome sem caixa nem acento — rodar de
   * novo depois de o dono renomear um procedimento não pode duplicá-lo. Preço
   * e duração ficam vazios porque a API do fornecedor não os devolve.
   */
  async importNames(
    clinicId: string,
    names: readonly string[],
  ): Promise<ImportProceduresResult> {
    const existing = await this.prisma.procedure.findMany({
      where: { clinicId },
      select: { name: true },
    });
    const known = new Set(existing.map((row) => normalizeName(row.name)));

    const missing: string[] = [];
    for (const name of names) {
      const key = normalizeName(name);
      if (!key || known.has(key)) continue;
      known.add(key);
      missing.push(name.trim());
    }

    if (missing.length > 0) {
      await this.prisma.procedure.createMany({
        data: missing.map((name) => ({ clinicId, name })),
      });
    }

    return {
      importados: missing.length,
      jaExistiam: names.length - missing.length,
    };
  }

  /** Cria um procedimento na empresa, associando as tags informadas. */
  async create(
    clinicId: string,
    input: CreateProcedureInput,
  ): Promise<ProcedureDto> {
    const { tagIds, ...rest } = input;
    await this.assertTagsOwned(clinicId, tagIds);
    const row = await this.prisma.procedure.create({
      data: {
        clinicId,
        ...rest,
        ...(tagIds ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {}),
      },
      include: WITH_TAGS,
    });
    return toDto(row);
  }

  /** Atualiza um procedimento da empresa (404 se não pertencer ao tenant). */
  async update(
    clinicId: string,
    id: string,
    input: UpdateProcedureInput,
  ): Promise<ProcedureDto> {
    await this.ensureExists(clinicId, id);
    const { tagIds, ...rest } = input;
    await this.assertTagsOwned(clinicId, tagIds);
    const row = await this.prisma.procedure.update({
      where: { id },
      // `set` substitui o conjunto de tags pelo informado (só quando enviado).
      data: {
        ...rest,
        ...(tagIds ? { tags: { set: tagIds.map((id) => ({ id })) } } : {}),
      },
      include: WITH_TAGS,
    });
    return toDto(row);
  }

  /** Remove um procedimento da empresa (404 se não pertencer ao tenant). */
  async remove(clinicId: string, id: string): Promise<{ id: string }> {
    await this.ensureExists(clinicId, id);
    await this.prisma.procedure.delete({ where: { id } });
    return { id };
  }

  /** Garante que o procedimento existe e pertence à empresa do tenant. */
  private async ensureExists(clinicId: string, id: string): Promise<void> {
    const found = await this.prisma.procedure.findFirst({
      where: { id, clinicId },
      select: { id: true },
    });
    if (!found)
      throw new NotFoundException(`Procedimento ${id} não encontrado.`);
  }

  /** Garante que todas as tags informadas pertencem à empresa (anti cross-tenant). */
  private async assertTagsOwned(
    clinicId: string,
    tagIds?: string[],
  ): Promise<void> {
    if (!tagIds || tagIds.length === 0) return;
    const unique = [...new Set(tagIds)];
    const count = await this.prisma.tag.count({
      where: { clinicId, id: { in: unique } },
    });
    if (count !== unique.length) {
      throw new BadRequestException(
        'Uma ou mais tags não pertencem à empresa.',
      );
    }
  }
}
