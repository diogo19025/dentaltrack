import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { newCorrelationId, runWithContext } from '../common/request-context';
import { WhatsappConnectionService } from '../whatsapp/connection.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

/** Manutenção operacional do canal que não pode depender da tela estar aberta. */
@Injectable()
export class WhatsappJobs {
  private readonly logger = new Logger(WhatsappJobs.name);
  private checking = false;

  constructor(
    private readonly connections: WhatsappConnectionService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /** Estado persistido em até cinco minutos + reconexão limitada a 15 min. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkConnections(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    await runWithContext(
      { requestId: newCorrelationId('job'), channel: 'job' },
      async () => {
        try {
          const result = await this.connections.checkAllConnections();
          this.logger.log({
            event: 'whatsapp.connection.check',
            outcome: 'ok',
            checked: result.checked,
            reconnectAttempts: result.reconnectAttempts,
          });
        } catch (err) {
          this.logger.error(
            {
              event: 'whatsapp.connection.check',
              outcome: 'fail',
              reason: err instanceof Error ? err.name : 'desconhecido',
            },
            err instanceof Error ? err.stack : undefined,
          );
        } finally {
          this.checking = false;
        }
      },
    );
  }

  /** Claims de webhook com mais de sete dias já não protegem reentrega útil. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupInboundMessages(): Promise<void> {
    const removed = await this.whatsapp.cleanupInboundMessages();
    if (removed > 0) {
      this.logger.log({
        event: 'whatsapp.inbound.cleanup',
        outcome: 'ok',
        removed,
      });
    }
  }
}
