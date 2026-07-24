import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateTagInput, UpdateTagInput } from '@dentaltrack/shared';
import { Prisma, type Tag } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tags de interesse da empresa (BE-2.3). CRUD escopado por `clinicId`. As
 * `keywords` alimentam o auto-tagging (F3). Nome é único por empresa
 * (`@@unique([clinicId, name])`) → duplicata vira 409.
 */
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista as tags da empresa (ordem alfabética). */
  list(clinicId: string): Promise<Tag[]> {
    return this.prisma.tag.findMany({
      where: { clinicId },
      orderBy: { name: 'asc' },
    });
  }

  /** Cria uma tag na empresa (409 se o nome já existir). */
  create(clinicId: string, input: CreateTagInput): Promise<Tag> {
    return this.run(() =>
      this.prisma.tag.create({ data: { clinicId, ...input } }),
    );
  }

  /** Atualiza uma tag da empresa (404 se não pertencer ao tenant, 409 se nome duplicado). */
  async update(
    clinicId: string,
    id: string,
    input: UpdateTagInput,
  ): Promise<Tag> {
    await this.ensureExists(clinicId, id);
    return this.run(() =>
      this.prisma.tag.update({ where: { id }, data: input }),
    );
  }

  /** Remove uma tag da empresa (404 se não pertencer ao tenant). */
  async remove(clinicId: string, id: string): Promise<{ id: string }> {
    await this.ensureExists(clinicId, id);
    await this.prisma.tag.delete({ where: { id } });
    return { id };
  }

  /** Garante que a tag existe e pertence à empresa do tenant. */
  private async ensureExists(clinicId: string, id: string): Promise<void> {
    const found = await this.prisma.tag.findFirst({
      where: { id, clinicId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Tag ${id} não encontrada.`);
  }

  /** Traduz a violação de unicidade (P2002) do Prisma em 409 amigável. */
  private async run<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Já existe uma tag com esse nome.');
      }
      throw err;
    }
  }
}
