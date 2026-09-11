import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedRequest } from './types';

@Roles('owner')
class OwnerController {
  action() {}
}

class MixedController {
  publicAction() {}

  @Roles('owner')
  ownerAction() {}
}

function context(
  role: AuthenticatedRequest['role'],
  controller: object,
  handler: () => void,
): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ role }) }),
  } as unknown as ExecutionContext;
}

function method(prototype: object, name: string): () => void {
  return Reflect.get(prototype, name) as () => void;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('permite owner em rota restrita', () => {
    const ctx = context(
      'owner',
      OwnerController,
      method(OwnerController.prototype, 'action'),
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('devolve 403 para staff em rota restrita', () => {
    const ctx = context(
      'staff',
      OwnerController,
      method(OwnerController.prototype, 'action'),
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('nega por padrão se o TenantGuard não preencheu o papel', () => {
    const ctx = context(
      undefined,
      OwnerController,
      method(OwnerController.prototype, 'action'),
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('permite rota sem @Roles', () => {
    const ctx = context(
      'staff',
      MixedController,
      method(MixedController.prototype, 'publicAction'),
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('considera @Roles no método', () => {
    const ctx = context(
      'staff',
      MixedController,
      method(MixedController.prototype, 'ownerAction'),
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
