import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest } from './types';

function httpContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('TenantGuard', () => {
  const prisma = { membership: { findFirst: jest.fn() } };
  const guard = new TenantGuard(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('resolve clinicId e role na mesma consulta da membership', async () => {
    prisma.membership.findFirst.mockResolvedValueOnce({
      clinicId: 'clinic-1',
      role: 'staff',
    });
    const request: Partial<AuthenticatedRequest> = {
      user: { id: 'user-1', raw: {} },
    };

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(request).toMatchObject({ clinicId: 'clinic-1', role: 'staff' });
    expect(prisma.membership.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'asc' },
      select: { clinicId: true, role: true },
    });
  });

  it('nega usuário autenticado sem membership', async () => {
    prisma.membership.findFirst.mockResolvedValueOnce(null);
    await expect(
      guard.canActivate(httpContext({ user: { id: 'user-1', raw: {} } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('nega request sem usuário', async () => {
    await expect(guard.canActivate(httpContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
