import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthenticatedRequest } from "./types";

/** Injeta o `clinicId` resolvido pelo TenantGuard (multi-tenant). */
export const ClinicId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().clinicId;
  },
);
