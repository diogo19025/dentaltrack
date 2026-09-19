import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExternalProfessional } from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ProfessionalsService } from './professionals.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';
const NOW = new Date('2026-09-17T12:00:00.000Z');

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'p-local-1',
    clinicId: CLINIC,
    externalId: '10',
    name: 'Dra. Ana Ribeiro',
    active: true,
    unitExternalId: '1',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function external(
  over: Partial<ExternalProfessional> = {},
): ExternalProfessional {
  return { id: '10', name: 'Dra. Ana Ribeiro', unitId: '1', ...over };
}

describe('ProfessionalsService (cadastro espelhado · F20)', () => {
  let service: ProfessionalsService;
  const prismaMock = {
    professional: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    appointment: { count: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.professional.findMany.mockResolvedValue([]);
    prismaMock.professional.count.mockResolvedValue(0);
    prismaMock.appointment.count.mockResolvedValue(0);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProfessionalsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(ProfessionalsService);
  });

  describe('list', () => {
    it('ordena por entrada, e não por nome — é dela que sai a cor de cada um', async () => {
      prismaMock.professional.findMany.mockResolvedValueOnce([row()]);

      await service.list(CLINIC);

      expect(prismaMock.professional.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('esconde os inativos por padrão e os inclui sob demanda', async () => {
      await service.list(CLINIC);
      expect(prismaMock.professional.findMany.mock.calls[0][0].where).toEqual({
        clinicId: CLINIC,
        active: true,
      });

      await service.list(CLINIC, { includeInactive: true });
      expect(prismaMock.professional.findMany.mock.calls[1][0].where).toEqual({
        clinicId: CLINIC,
      });
    });

    it('normaliza os nulos do banco para texto vazio no contrato', async () => {
      prismaMock.professional.findMany.mockResolvedValueOnce([
        row({ externalId: null, unitExternalId: null }),
      ]);

      const [dto] = await service.list(CLINIC);

      expect(dto.externalId).toBe('');
      expect(dto.unitExternalId).toBe('');
      expect(dto.createdAt).toBe(NOW.toISOString());
    });
  });

  describe('resolveExternalId', () => {
    it('converte o UUID local no id que o Clinicorp entende', async () => {
      prismaMock.professional.findFirst.mockResolvedValueOnce(row());

      await expect(
        service.resolveExternalId(CLINIC, 'p-local-1', {
          unitExternalId: '1',
        }),
      ).resolves.toBe('10');
    });

    it('recusa manual, inativo e profissional de outra unidade', async () => {
      for (const invalid of [
        row({ externalId: null }),
        row({ active: false }),
        row({ unitExternalId: '2' }),
      ]) {
        prismaMock.professional.findFirst.mockResolvedValueOnce(invalid);
        await expect(
          service.resolveExternalId(CLINIC, invalid.id, {
            unitExternalId: '1',
          }),
        ).resolves.toBeNull();
      }
    });

    it('preserva id externo legado somente antes de existir um espelho validável', async () => {
      prismaMock.professional.findFirst.mockResolvedValue(null);
      prismaMock.professional.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2);

      await expect(
        service.resolveExternalId(CLINIC, '10', { unitExternalId: '1' }),
      ).resolves.toBe('10');
      await expect(
        service.resolveExternalId(CLINIC, 'desconhecido', {
          unitExternalId: '1',
        }),
      ).resolves.toBeNull();
    });
  });

  describe('syncFromProvider — a reconciliação com o sistema de gestão', () => {
    it('cria quem chegou pela primeira vez', async () => {
      prismaMock.professional.findMany.mockResolvedValueOnce([]);

      const summary = await service.syncFromProvider(CLINIC, [external()]);

      expect(summary).toEqual({
        criados: 1,
        atualizados: 0,
        desativados: 0,
      });
      expect(prismaMock.professional.create).toHaveBeenCalledWith({
        data: {
          clinicId: CLINIC,
          externalId: '10',
          name: 'Dra. Ana Ribeiro',
          unitExternalId: '1',
          active: true,
        },
      });
    });

    it('não reescreve quem não mudou', async () => {
      prismaMock.professional.findMany.mockResolvedValueOnce([row()]);

      const summary = await service.syncFromProvider(CLINIC, [external()]);

      expect(summary.atualizados).toBe(0);
      expect(prismaMock.professional.update).not.toHaveBeenCalled();
      expect(prismaMock.professional.create).not.toHaveBeenCalled();
    });

    it('acompanha o nome trocado no painel do cliente', async () => {
      prismaMock.professional.findMany.mockResolvedValueOnce([row()]);

      const summary = await service.syncFromProvider(CLINIC, [
        external({ name: 'Dra. Ana R. Souza' }),
      ]);

      expect(summary.atualizados).toBe(1);
      expect(prismaMock.professional.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Dra. Ana R. Souza' }),
        }),
      );
    });

    it('reativa quem voltou a aparecer na conta', async () => {
      prismaMock.professional.findMany.mockResolvedValueOnce([
        row({ active: false }),
      ]);

      const summary = await service.syncFromProvider(CLINIC, [external()]);

      expect(summary.atualizados).toBe(1);
      expect(prismaMock.professional.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ active: true }),
        }),
      );
    });

    it('desativa quem sumiu — e nunca apaga, porque há agendamento apontando', async () => {
      prismaMock.professional.findMany.mockResolvedValueOnce([
        row(),
        row({ id: 'p-local-2', externalId: '11', name: 'Dr. Bruno Lima' }),
      ]);

      const summary = await service.syncFromProvider(CLINIC, [external()]);

      expect(summary.desativados).toBe(1);
      expect(prismaMock.professional.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['p-local-2'] } },
        data: { active: false },
      });
      expect(prismaMock.professional.delete).not.toHaveBeenCalled();
    });

    it('lista vazia não desativa ninguém', async () => {
      // Uma resposta transitoriamente vazia do fornecedor — que é o que o
      // field-reader produz quando o formato diverge, por desenho — apagaria a
      // equipe inteira da tela e faria o agente parar de oferecer qualquer
      // profissional. Na dúvida, não mexe.
      const summary = await service.syncFromProvider(CLINIC, []);

      expect(summary).toEqual({
        criados: 0,
        atualizados: 0,
        desativados: 0,
      });
      expect(prismaMock.professional.findMany).not.toHaveBeenCalled();
      expect(prismaMock.professional.updateMany).not.toHaveBeenCalled();
    });

    it('ignora o cadastro manual ao reconciliar — ele não vem do provedor', async () => {
      await service.syncFromProvider(CLINIC, [external()]);

      expect(prismaMock.professional.findMany).toHaveBeenCalledWith({
        where: { clinicId: CLINIC, externalId: { not: null } },
      });
    });
  });

  describe('remove', () => {
    it('quem veio do sistema de gestão é desativado, nunca apagado', async () => {
      prismaMock.professional.findFirst.mockResolvedValueOnce(row());

      await service.remove(CLINIC, 'p-local-1');

      expect(prismaMock.professional.update).toHaveBeenCalledWith({
        where: { id: 'p-local-1' },
        data: { active: false },
      });
      expect(prismaMock.professional.delete).not.toHaveBeenCalled();
    });

    it('cadastro manual com histórico também só é desativado', async () => {
      prismaMock.professional.findFirst.mockResolvedValueOnce(
        row({ externalId: null }),
      );
      prismaMock.appointment.count.mockResolvedValueOnce(3);

      await service.remove(CLINIC, 'p-local-1');

      expect(prismaMock.professional.delete).not.toHaveBeenCalled();
    });

    it('cadastro manual sem histórico some de verdade', async () => {
      prismaMock.professional.findFirst.mockResolvedValueOnce(
        row({ externalId: null }),
      );

      await service.remove(CLINIC, 'p-local-1');

      expect(prismaMock.professional.delete).toHaveBeenCalledWith({
        where: { id: 'p-local-1' },
      });
    });

    it('profissional de outra empresa é 404, não 403', async () => {
      prismaMock.professional.findFirst.mockResolvedValueOnce(null);

      await expect(service.remove(CLINIC, 'p-de-outra')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('match — o nome que o cliente escreveu', () => {
    const team = () => [
      row({ id: 'p-ana', externalId: '10', name: 'Dra. Ana Paula Souza' }),
      row({ id: 'p-ana2', externalId: '11', name: 'Ana Clara Lima' }),
      row({ id: 'p-bruno', externalId: '12', name: 'Dr. Bruno Lima' }),
      row({ id: 'p-jose', externalId: '13', name: 'José Antônio' }),
    ];

    beforeEach(() => {
      prismaMock.professional.findMany.mockResolvedValue(team());
    });

    it('"Dra. Ana" é ambíguo quando há duas Anas — quem decide é o cliente', async () => {
      const result = await service.match(CLINIC, 'Dra. Ana');
      expect(result.kind).toBe('ambiguo');
      if (result.kind === 'ambiguo') {
        expect(result.options.map((p) => p.id)).toEqual(['p-ana', 'p-ana2']);
      }
    });

    it('"ana paula" desambigua pelo segundo nome', async () => {
      const result = await service.match(CLINIC, 'ana paula');
      expect(result).toMatchObject({
        kind: 'um',
        professional: { id: 'p-ana' },
      });
    });

    it('ignora acento, caixa e tratamento ("doutor bruno" ≈ "Dr. Bruno Lima")', async () => {
      const result = await service.match(CLINIC, 'doutor BRUNO');
      expect(result).toMatchObject({
        kind: 'um',
        professional: { id: 'p-bruno' },
      });
      const semAcento = await service.match(CLINIC, 'jose antonio');
      expect(semAcento).toMatchObject({
        kind: 'um',
        professional: { id: 'p-jose' },
      });
    });

    it('prefixo basta ("bru"), mas sobrenome que não existe não casa', async () => {
      expect(await service.match(CLINIC, 'bru')).toMatchObject({
        kind: 'um',
        professional: { id: 'p-bruno' },
      });
      expect(await service.match(CLINIC, 'Bruno Ferreira')).toEqual({
        kind: 'nenhum',
      });
    });

    it('nome inteiro igual vence mesmo quando o prefixo casaria com outro', async () => {
      prismaMock.professional.findMany.mockResolvedValue([
        row({ id: 'p-ana', externalId: '10', name: 'Ana' }),
        row({ id: 'p-anab', externalId: '11', name: 'Anabela' }),
      ]);
      expect(await service.match(CLINIC, 'ana')).toMatchObject({
        kind: 'um',
        professional: { id: 'p-ana' },
      });
    });

    it('texto vazio ou só tratamento não casa ninguém', async () => {
      expect(await service.match(CLINIC, '  ')).toEqual({ kind: 'nenhum' });
      expect(await service.match(CLINIC, 'Dra.')).toEqual({ kind: 'nenhum' });
    });

    it('só considera os ativos', async () => {
      await service.match(CLINIC, 'bruno');
      expect(prismaMock.professional.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });
  });

  describe('findByExternalId', () => {
    it('devolve o profissional pelo id do sistema de gestão, ativo ou não', async () => {
      prismaMock.professional.findFirst.mockResolvedValueOnce(
        row({ active: false }),
      );
      const found = await service.findByExternalId(CLINIC, '10');
      expect(found).toMatchObject({ id: 'p-local-1', active: false });
      expect(prismaMock.professional.findFirst).toHaveBeenCalledWith({
        where: { clinicId: CLINIC, externalId: '10' },
      });
    });
  });
});
