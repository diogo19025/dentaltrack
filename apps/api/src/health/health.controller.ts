import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@dentaltrack/shared';
import { Public } from '../auth/public.decorator';
import { isSentryEnabled } from '../common/sentry';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from '../whatsapp/evolution.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionService,
  ) {}

  /**
   * GET /health — público; verifica o banco (BE-0.1) e identifica o deploy (P0.3).
   *
   * Nada aqui faz chamada externa: é o healthcheck do Railway, bate a cada
   * poucos segundos, e um `/health` que depende da Evolution derrubaria o
   * serviço inteiro quando o WhatsApp estivesse fora do ar — exatamente quando
   * o produto ainda funciona para todo o resto.
   */
  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    let db: HealthResponse['db'] = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    return {
      status: 'ok',
      db,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION ?? null,
      whatsapp: this.evolution.isConfigured()
        ? 'configurado'
        : 'nao_configurado',
      monitoramento: isSentryEnabled() ? 'ativo' : 'desligado',
    };
  }
}
