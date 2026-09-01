import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AgendaSyncService } from '../agenda/agenda-sync.service';
import { AutomationPlannerService } from '../automations/automation-planner.service';
import { HolidaysService } from '../automations/holidays.service';
import { OutboundService } from '../automations/outbound.service';
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

  /** Traz a agenda do sistema de gestão para cá. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncAgenda(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const summary = await this.sync.syncAll();
      if (summary.criados > 0 || summary.atualizados > 0) {
        this.logger.log(
          `Agenda sincronizada: ${summary.criados} novo(s), ${summary.atualizados} atualizado(s), ${summary.ignorados} ignorado(s).`,
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha na sincronização da agenda: ${detail}`);
    } finally {
      this.syncing = false;
    }
  }

  /** Decide o que precisa sair e despacha o que já venceu. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runAutomations(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const planned = await this.planner.planAll();
      const summary = await this.outbound.dispatchDue();
      if (planned > 0 || summary.enviados > 0 || summary.suprimidos > 0) {
        this.logger.log(
          `Automações: ${planned} enfileirada(s), ${summary.enviados} enviada(s), ${summary.suprimidos} suprimida(s), ${summary.falhas} falha(s).`,
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha na rodada de automações: ${detail}`);
    } finally {
      this.dispatching = false;
    }
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
