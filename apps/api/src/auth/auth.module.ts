import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseJwtGuard } from './supabase-jwt.guard';
import { TenantGuard } from './tenant.guard';
import { RolesGuard } from './roles.guard';

/**
 * Auth global: o SupabaseJwtGuard protege todas as rotas (menos @Public).
 * O TenantGuard fica exportado para uso por rota (escopo de empresa).
 */
@Global()
@Module({
  providers: [
    { provide: APP_GUARD, useClass: SupabaseJwtGuard },
    TenantGuard,
    RolesGuard,
  ],
  exports: [TenantGuard, RolesGuard],
})
export class AuthModule {}
