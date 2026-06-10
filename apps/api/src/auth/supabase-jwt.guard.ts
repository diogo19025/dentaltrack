import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { Env } from '../config/env.validation';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedRequest } from './types';

/**
 * Valida o JWT do Supabase em todas as rotas (exceto @Public).
 * Suporta HS256 (segredo) e assimétrico (JWKS) — cobre projetos novos e legados.
 */
@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseJwtGuard.name);
  private jwks?: JWTVerifyGetKey;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de autenticação ausente.');
    }

    try {
      const payload = await this.verify(header.slice(7).trim());
      if (!payload.sub) throw new Error("claim 'sub' ausente");
      request.user = {
        id: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        role: typeof payload.role === 'string' ? payload.role : undefined,
        raw: payload,
      };
      return true;
    } catch (err) {
      this.logger.debug(
        `JWT inválido: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Token de autenticação inválido.');
    }
  }

  private async verify(token: string): Promise<JWTPayload> {
    const secret = this.config.get('SUPABASE_JWT_SECRET', { infer: true });
    const { alg } = decodeProtectedHeader(token);

    // HS256 simétrico (projetos Supabase legados).
    if (alg === 'HS256' && secret) {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(secret),
        {
          audience: 'authenticated',
        },
      );
      return payload;
    }

    // Assimétrico (ES256/RS256) → JWKS público do Supabase.
    if (!this.jwks) {
      const url = this.config.get('SUPABASE_URL', { infer: true });
      this.jwks = createRemoteJWKSet(
        new URL(`${url}/auth/v1/.well-known/jwks.json`),
      );
    }
    const { payload } = await jwtVerify(token, this.jwks, {
      audience: 'authenticated',
    });
    return payload;
  }
}
