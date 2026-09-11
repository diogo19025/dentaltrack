import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

/** Padrão da política: um ano de histórico de mensagens enviadas. */
const DEFAULT_RETENTION_DAYS = 365;

/** Piso de segurança: nenhuma configuração pode apagar o mês corrente. */
const MIN_RETENTION_DAYS = 30;

/**
 * **Retenção de dados** (P1.5) — expurgo periódico do que já cumpriu a função.
 *
 * **Nasce desligado, e isso é a decisão de produto, não um descuido.** Apagar
 * dado de cliente sem ele ter pedido é pior do que guardar demais: o histórico
 * de mensagens é o que responde "o que foi combinado com essa pessoa?" quando
 * alguém reclama, e ele não volta. Ligar é decisão do dono, com a política
 * escrita no runbook — por isso `RETENTION_ENABLED` precisa ser dito
 * explicitamente, sem default permissivo.
 *
 * O alvo é estreito de propósito: **só a fila de saída já finalizada**. Ela é
 * registro operacional ("o lembrete saiu?"), não histórico de atendimento. O
 * que a pessoa escreveu na conversa **não** é expurgado por tempo — sai por
 * pedido do titular, pelo `LeadPrivacyService`, que é o caminho que a LGPD
 * prevê. E a `InboundMessage` já tem limpeza própria (P0.4), com janela de
 * dias, porque é só um registro anti-reentrega.
 */
@Injectable()
export class RetentionJobs {
  private readonly logger = new Logger(RetentionJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Ligada? Sem a env dita explicitamente, não. */
  private get enabled(): boolean {
    return this.config.get('RETENTION_ENABLED', { infer: true }) === true;
  }

  /** Dias de retenção, nunca abaixo do piso. */
  private get retentionDays(): number {
    const configured = this.config.get('DATA_RETENTION_DAYS', { infer: true });
    return Math.max(MIN_RETENTION_DAYS, configured ?? DEFAULT_RETENTION_DAYS);
  }

  /**
   * Apaga mensagens de saída **finalizadas** mais velhas que a janela.
   *
   * `pendente` e `enviando` ficam fora do filtro de propósito: uma linha presa
   * na fila é um problema a investigar, e apagá-la esconderia exatamente o
   * sintoma. O expurgo é do que já terminou.
   *
   * Público e com o relógio injetável para ser testável sem o scheduler.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOutbound(now = new Date()): Promise<number> {
    if (!this.enabled) return 0;

    const cutoff = new Date(
      now.getTime() - this.retentionDays * 24 * 3_600_000,
    );
    const { count } = await this.prisma.outboundMessage.deleteMany({
      where: {
        status: { in: ['enviado', 'falhou', 'suprimido', 'cancelado'] },
        createdAt: { lt: cutoff },
      },
    });

    if (count > 0) {
      this.logger.log({
        event: 'retention.purge',
        outcome: 'ok',
        removidas: count,
        janelaDias: this.retentionDays,
      });
    }
    return count;
  }
}
