import { SetMetadata } from '@nestjs/common';
import type { Role } from '@dentaltrack/shared';

export const ROLES_KEY = 'roles';

/** Restringe uma rota aos papéis informados. Usar depois do TenantGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
