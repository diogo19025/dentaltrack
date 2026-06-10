import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest } from './types';

/**
 * Resolve o `clinicId` do usuário autenticado via Membership (multi-tenant).
 * Aplicar (com @UseGuards) nas rotas que exigem escopo de clínica.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();

    const membership = await this.prisma.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) {
      throw new ForbiddenException('Usuário sem clínica vinculada.');
    }

    request.clinicId = membership.clinicId;
    return true;
  }
}
