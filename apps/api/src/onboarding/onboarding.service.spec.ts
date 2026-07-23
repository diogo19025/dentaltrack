import { Test } from '@nestjs/testing';
import { OnboardingService } from './onboarding.service';
import { PrismaService } from '../prisma/prisma.service';

const USER_ID = '11111111-1111-1111-1111-111111111111';

/** Cria um mock do client de transação (tx) usado dentro do $transaction. */
function makeTx(over: {
  innerFindFirst?: unknown;
  clinic?: { id: string; name: string };
}) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    membership: {
      findFirst: jest.fn().mockResolvedValueOnce(over.innerFindFirst ?? null),
      create: jest.fn().mockResolvedValue({}),
    },
    clinic: {
      create: jest
        .fn()
        .mockResolvedValue(
          over.clinic ?? { id: 'clinic-novo', name: 'Minha empresa' },
        ),
    },
  };
}

describe('OnboardingService.ensureClinic', () => {
  let service: OnboardingService;
  const prismaMock = {
    membership: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(OnboardingService);
  });

  it('idempotente: já tem membership → devolve a empresa existente, sem abrir transação', async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce({
      clinicId: 'clinic-existente',
    });

    const res = await service.ensureClinic({ userId: USER_ID });

    expect(res).toEqual({ clinicId: 'clinic-existente', created: false });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('sem membership → adquire o lock, cria empresa + membership (owner)', async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce(null); // caminho rápido
    const tx = makeTx({ clinic: { id: 'clinic-novo', name: 'Empresa Teste' } });
    prismaMock.$transaction.mockImplementationOnce(
      (cb: (t: typeof tx) => unknown) => cb(tx),
    );

    const res = await service.ensureClinic({
      userId: USER_ID,
      clinicName: 'Empresa Teste',
    });

    expect(tx.$executeRaw).toHaveBeenCalled(); // advisory lock
    expect(tx.clinic.create).toHaveBeenCalledWith({
      data: { name: 'Empresa Teste' },
    });
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, clinicId: 'clinic-novo' },
    });
    expect(res).toEqual({ clinicId: 'clinic-novo', created: true });
  });

  it('concorrência: outra chamada provisionou durante o lock → devolve sem duplicar', async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce(null); // caminho rápido: nada
    const tx = makeTx({ innerFindFirst: { clinicId: 'clinic-concorrente' } });
    prismaMock.$transaction.mockImplementationOnce(
      (cb: (t: typeof tx) => unknown) => cb(tx),
    );

    const res = await service.ensureClinic({ userId: USER_ID });

    expect(res).toEqual({ clinicId: 'clinic-concorrente', created: false });
    expect(tx.clinic.create).not.toHaveBeenCalled();
  });

  it('usa nome padrão quando não vem clinicName', async () => {
    prismaMock.membership.findFirst.mockResolvedValueOnce(null);
    const tx = makeTx({ clinic: { id: 'c2', name: 'Minha empresa' } });
    prismaMock.$transaction.mockImplementationOnce(
      (cb: (t: typeof tx) => unknown) => cb(tx),
    );

    await service.ensureClinic({ userId: USER_ID });

    expect(tx.clinic.create).toHaveBeenCalledWith({
      data: { name: 'Minha empresa' },
    });
  });
});
