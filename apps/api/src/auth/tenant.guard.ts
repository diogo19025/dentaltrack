import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { setContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest } from './types';

/**
 * Resolve o `clinicId` do usuário autenticado via Membership (multi-tenant).
 * Aplicar (com @UseGuards) nas rotas que exigem escopo de empresa.
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
      throw new ForbiddenException('Usuário sem empresa vinculada.');
    }

    request.clinicId = membership.clinicId;
    // A empresa só é conhecida aqui: a partir deste ponto todo log do request
    // sai com o `clinicId`, que é como se investiga um problema num produto
    // multi-tenant sem abrir o banco (P0.3).
    setContext({ clinicId: membership.clinicId });
    return true;
  }
}
