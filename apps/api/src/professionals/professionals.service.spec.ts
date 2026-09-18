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
    },
    appointment: { count: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.professional.findMany.mockResolvedValue([]);
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
});
