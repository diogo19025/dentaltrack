import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@dentaltrack/shared';
import { Public } from '../auth/public.decorator';
import { isSentryEnabled } from '../common/sentry';
import { MediaStorageService } from '../media/media-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from '../whatsapp/evolution.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionService,
    private readonly media: MediaStorageService,
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
      version: appVersion(),
      whatsapp: this.evolution.isConfigured()
        ? 'configurado'
        : 'nao_configurado',
      arquivos: this.media.isConfigured() ? 'configurado' : 'nao_configurado',
      monitoramento: isSentryEnabled() ? 'ativo' : 'desligado',
    };
  }
}

/**
 * Commit publicado — `null` quando não dá para saber.
 *
 * String vazia conta como **não saber**, e essa distinção custou uma
 * investigação: `APP_VERSION=${{ RAILWAY_GIT_COMMIT_SHA }}` pode chegar ao
 * container vazio (a referência existe, o valor não), e com `??` o `/health`
 * respondia `"version": ""` — que parece configurado, some num log e não
 * responde a pergunta que a variável existe para responder (docs/engenharia.md, regra 7).
 * `null` é honesto: ninguém confunde com um SHA.
 */
function appVersion(): string | null {
  const raw = process.env.APP_VERSION?.trim();
  return raw ? raw : null;
}
