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

  /** Profissional pelo id no sistema de gestão (ativo ou não). */
  async findByExternalId(
    clinicId: string,
    externalId: string,
  ): Promise<ProfessionalDto | null> {
    const row = await this.prisma.professional.findFirst({
      where: { clinicId, externalId },
    });
    return row ? toDto(row) : null;
  }

  /**
   * Normaliza o valor persistido em `ClinicIntegration.professionalId` para o
   * identificador que o provedor entende.
   *
   * A tela do primeiro PR da F20 chegou a salvar o UUID local (`Professional.id`)
   * neste campo, que historicamente guarda o id externo do Clinicorp. Aceitar os
   * dois formatos aqui mantém as escolhas já salvas funcionando, sem mandar um
   * UUID nosso para a API do fornecedor. Profissional manual, inativo ou de
   * outra unidade não pode virar padrão de uma agenda externa.
   */
  async resolveExternalId(
    clinicId: string,
    value: string | null | undefined,
    options: { unitExternalId?: string | null } = {},
  ): Promise<string | null> {
    if (!value) return null;

    const row = await this.prisma.professional.findFirst({
      where: {
        clinicId,
        OR: [{ id: value }, { externalId: value }],
      },
    });
    if (row) {
      if (!row.active || !row.externalId) return null;
      if (
        options.unitExternalId &&
        row.unitExternalId !== options.unitExternalId
      ) {
        return null;
      }
      return row.externalId;
    }

    // Antes de o espelho existir, o campo já guardava o id externo. Só o
    // preservamos quando ainda não há cadastro capaz de validar a escolha.
    const mirrored = await this.prisma.professional.count({
      where: {
        clinicId,
        externalId: { not: null },
        ...(options.unitExternalId
          ? { unitExternalId: options.unitExternalId }
          : {}),
      },
    });
    return mirrored === 0 ? value : null;
  }

  /**
   * Casa o que o cliente escreveu com um profissional **ativo**.
   *
   * Tolerante de propósito: "Dra. Ana" tem que achar "Ana Paula Souza", e
   * "bruno lima" tem que achar "Dr. Bruno Lima". Cada palavra do pedido
   * precisa ser prefixo de alguma palavra do nome, sem acento, caixa nem
   * tratamento (dr., dra., doutor). O nome inteiro igual vence a lista.
   * Mais de um candidato é ambíguo — quem decide é o cliente, não a heurística.
   */
  async match(clinicId: string, text: string): Promise<ProfessionalMatch> {
    const active = await this.listActive(clinicId);
    return this.matchCandidates(text, active);
  }

  /** Mesmo casamento de `match`, restrito a uma lista já escopada. */
  matchCandidates(
    text: string,
    candidates: readonly ProfessionalDto[],
  ): ProfessionalMatch {
    const wanted = nameTokens(text);
    if (wanted.length === 0) return { kind: 'nenhum' };

    const exact = candidates.filter(
      (p) => nameTokens(p.name).join(' ') === wanted.join(' '),
    );
    if (exact.length === 1) return { kind: 'um', professional: exact[0] };

    const matches = candidates.filter((p) => {
      const tokens = nameTokens(p.name);
      return wanted.every((w) => tokens.some((t) => t.startsWith(w)));
    });
    if (matches.length === 1) {
      return { kind: 'um', professional: matches[0] };
    }
    if (matches.length > 1) {
      return { kind: 'ambiguo', options: matches };
    }
    return { kind: 'nenhum' };
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

/** Resultado do casamento de nome (ver `match`). */
export type ProfessionalMatch =
  | { kind: 'um'; professional: ProfessionalDto }
  | { kind: 'ambiguo'; options: ProfessionalDto[] }
  | { kind: 'nenhum' };

/** Tratamentos que não distinguem ninguém e que o cliente usa à vontade. */
const HONORIFICS = new Set(['dr', 'dra', 'doutor', 'doutora', 'prof', 'profa']);

/** Palavras comparáveis de um nome: sem acento, caixa, pontuação nem tratamento. */
function nameTokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !HONORIFICS.has(token));
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
