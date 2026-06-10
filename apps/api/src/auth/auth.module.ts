import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseJwtGuard } from './supabase-jwt.guard';
import { TenantGuard } from './tenant.guard';

/**
 * Auth global: o SupabaseJwtGuard protege todas as rotas (menos @Public).
 * O TenantGuard fica exportado para uso por rota (escopo de clínica).
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: SupabaseJwtGuard }, TenantGuard],
  exports: [TenantGuard],
})
export class AuthModule {}
