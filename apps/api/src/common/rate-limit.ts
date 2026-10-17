import { Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { decodeJwt } from 'jose';

/**
 * Rate limit HTTP (auditoria de segurança de 2026-09-27).
 *
 * Nenhuma rota tinha limite, e o cadastro é aberto: qualquer conta nova podia
 * chamar `/chat` (IA paga), `/media/upload` e `/leads/import` sem parar.
 *
 * O teto padrão é folgado de propósito. A tela faz polling (notificações a
 * cada 30 s, funil a cada 15 s, QR do WhatsApp a cada 3 s), e errar para o
 * lado apertado bloqueia gente trabalhando. As rotas caras têm teto próprio
 * com `@Throttle` no controller.
 */
export const DEFAULT_RATE_LIMIT = { ttl: 60_000, limit: 240 };
/** Turno de IA: cada chamada é paga. */
export const CHAT_RATE_LIMIT = { default: { ttl: 60_000, limit: 20 } };
/** Upload de arquivo e importação de planilha: pesados em memória. */
export const UPLOAD_RATE_LIMIT = { default: { ttl: 60_000, limit: 10 } };

/**
 * Conta por **usuário**, não por IP. O layout do Next chama a API a partir do
 * servidor da Vercel, cujo IP é compartilhado por todos os usuários: contar por
 * IP faria um usuário esgotar o limite dos outros.
 *
 * O `sub` é lido sem verificar a assinatura porque só escolhe o balde. Quem
 * forja um token até cai num balde próprio, mas o request é recusado pelo
 * `SupabaseJwtGuard` de qualquer jeito. Sem token, vale o IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    if (user?.id) return Promise.resolve(`user:${user.id}`);

    const headers = req.headers as Record<string, string | undefined>;
    const sub = subFromBearer(headers?.authorization);
    if (sub) return Promise.resolve(`user:${sub}`);

    const ip = typeof req.ip === 'string' ? req.ip : 'desconhecido';
    return Promise.resolve(`ip:${ip}`);
  }
}

function subFromBearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const { sub } = decodeJwt(header.slice(7).trim());
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [DEFAULT_RATE_LIMIT],
      errorMessage:
        'Muitas requisições em pouco tempo. Aguarde um instante e tente de novo.',
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class RateLimitModule {}
