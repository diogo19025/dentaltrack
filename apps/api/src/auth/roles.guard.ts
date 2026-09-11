import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@dentaltrack/shared';
import { ROLES_KEY } from './roles.decorator';
import type { AuthenticatedRequest } from './types';

/** Autoriza por papel depois que o TenantGuard resolveu a membership. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.role || !allowed.includes(request.role)) {
      throw new ForbiddenException('Seu perfil não permite esta ação.');
    }
    return true;
  }
}
