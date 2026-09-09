import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AgendaSyncService } from '../agenda/agenda-sync.service';
import { AutomationPlannerService } from '../automations/automation-planner.service';
import { HolidaysService } from '../automations/holidays.service';
import { OutboundService } from '../automations/outbound.service';
import { newCorrelationId, runWithContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Jobs da agenda e das automações (F9).
 *
 * Três ritmos, por razões diferentes:
 *
 * - **sincronizar (10 min)** — o sistema de gestão não avisa quando um status
 *   muda, então a agenda é lida por varredura. É este intervalo que define a
 *   frescura da detecção de falta e de atraso.
 * - **planejar e despachar (5 min)** — o lembrete de 1 hora e o aviso de atraso
 *   de 15 minutos precisam de granularidade fina; de hora em hora seria tarde.
 * - **feriados (1x/dia)** — o calendário muda uma vez por ano.
 *
 * Cada rodada é protegida contra sobreposição: o despacho é espaçado de
 * propósito (higiene anti-ban) e pode passar de um tique para o outro.
 */
@Injectable()
export class AgendaJobs {
  private readonly logger = new Logger(AgendaJobs.name);
  private syncing = false;
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: AgendaSyncService,
    private readonly planner: AutomationPlannerService,
    private readonly outbound: OutboundService,
    private readonly holidays: HolidaysService,
  ) {}

  /**
   * Traz a agenda do sistema de gestão para cá.
   *
   * Cada rodada abre o próprio escopo de correlação: um cron não nasce de um
   * request, e sem isso as linhas de várias empresas se misturam no log sem
   * nada que diga quais pertencem à mesma varredura (P0.3).
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncAgenda(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    const startedAt = Date.now();
    await runWithContext(
      { requestId: newCorrelationId('job'), channel: 'job' },
      async () => {
        try {
          const summary = await this.sync.syncAll();
          this.logger.log({
            event: 'agenda.sync',
            outcome: 'ok',
            durationMs: Date.now() - startedAt,
            criados: summary.criados,
            atualizados: summary.atualizados,
            ignorados: summary.ignorados,
          });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          this.logger.error(
            {
              event: 'agenda.sync',
              outcome: 'fail',
              durationMs: Date.now() - startedAt,
              reason: err instanceof Error ? err.name : 'desconhecido',
            },
            err instanceof Error ? err.stack : undefined,
          );
          this.logger.error(`Falha na sincronização da agenda: ${detail}`);
        } finally {
          this.syncing = false;
        }
      },
    );
  }

  /** Decide o que precisa sair e despacha o que já venceu. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runAutomations(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    const startedAt = Date.now();
    await runWithContext(
      { requestId: newCorrelationId('job'), channel: 'job' },
      async () => {
        try {
          const planned = await this.planner.planAll();
          const summary = await this.outbound.dispatchDue();
          this.logger.log({
            event: 'outbound.dispatch',
            outcome: 'ok',
            durationMs: Date.now() - startedAt,
            enfileiradas: planned,
            enviadas: summary.enviados,
            suprimidas: summary.suprimidos,
            falhas: summary.falhas,
          });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          this.logger.error(
            {
              event: 'outbound.dispatch',
              outcome: 'fail',
              durationMs: Date.now() - startedAt,
              reason: err instanceof Error ? err.name : 'desconhecido',
            },
            err instanceof Error ? err.stack : undefined,
          );
          this.logger.error(`Falha na rodada de automações: ${detail}`);
        } finally {
          this.dispatching = false;
        }
      },
    );
  }

  /**
   * Mantém os feriados nacionais em dia (ano corrente e o próximo). É
   * `create`-only lá dentro, então feriado que o dono ajustou não volta.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async syncHolidays(): Promise<void> {
    const clinics = await this.prisma.clinicSettings.findMany({
      where: { whatsappInstance: { not: null } },
      select: { clinicId: true },
    });
    const year = new Date().getUTCFullYear();
    for (const { clinicId } of clinics) {
      await this.holidays.syncNational(clinicId, year);
      await this.holidays.syncNational(clinicId, year + 1);
    }
  }
}
