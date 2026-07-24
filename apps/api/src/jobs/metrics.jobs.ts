import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** Horas de inatividade até marcar a conversa como abandonada (env, default 24). */
const ABANDON_AFTER_HOURS = Number(process.env.ABANDON_AFTER_HOURS ?? 24);

/**
 * Jobs agendados (BE-3.4 · `@nestjs/schedule`):
 * - **markAbandoned** (de hora em hora): conversas `em_andamento` sem atividade
 *   por N horas viram `abandonada` (context.md §10 — "sem atividade por N horas").
 * - **aggregateDaily** (1x/dia): pré-agrega `daily_metric` do dia anterior por
 *   empresa (alimenta o dashboard rápido; o GET /metrics calcula ao vivo no MVP).
 *
 * Os métodos são públicos para serem testáveis sem o scheduler.
 */
@Injectable()
export class MetricsJobs {
  private readonly logger = new Logger(MetricsJobs.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Marca conversas inativas como `abandonada`. Retorna quantas foram afetadas. */
  @Cron(CronExpression.EVERY_HOUR)
  async markAbandoned(): Promise<number> {
    const cutoff = new Date(Date.now() - ABANDON_AFTER_HOURS * 60 * 60 * 1000);
    const { count } = await this.prisma.conversation.updateMany({
      where: { status: 'em_andamento', lastMessageAt: { lt: cutoff } },
      data: { status: 'abandonada' },
    });
    if (count > 0)
      this.logger.log(
        `markAbandoned: ${count} conversa(s) marcada(s) como abandonada.`,
      );
    return count;
  }

  /** Pré-agrega as métricas do dia anterior em `daily_metric` (por empresa). */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async aggregateDaily(): Promise<void> {
    const today0 = startOfDay(new Date());
    const day = new Date(today0.getTime() - 24 * 60 * 60 * 1000); // ontem 00:00
    const next = today0; // hoje 00:00
    const window = { gte: day, lt: next };

    const clinics = await this.prisma.clinic.findMany({ select: { id: true } });
    for (const { id: clinicId } of clinics) {
      const [
        botMessages,
        userMessages,
        leads,
        conversationsStarted,
        conversationsScheduled,
      ] = await Promise.all([
        this.prisma.message.count({
          where: { clinicId, role: 'assistant', createdAt: window },
        }),
        this.prisma.message.count({
          where: { clinicId, role: 'user', createdAt: window },
        }),
        this.prisma.lead.count({ where: { clinicId, createdAt: window } }),
        this.prisma.conversation.count({
          where: { clinicId, createdAt: window },
        }),
        this.prisma.appointment.count({
          where: { clinicId, createdAt: window },
        }),
      ]);

      const data = {
        botMessages,
        userMessages,
        leads,
        conversationsStarted,
        conversationsScheduled,
      };
      await this.prisma.dailyMetric.upsert({
        where: { clinicId_date: { clinicId, date: day } },
        update: data,
        create: { clinicId, date: day, ...data },
      });
    }
    this.logger.log(
      `aggregateDaily: ${clinics.length} empresa(s) agregada(s) para ${day.toISOString().slice(0, 10)}.`,
    );
  }
}

/** Início do dia (00:00) local. */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
