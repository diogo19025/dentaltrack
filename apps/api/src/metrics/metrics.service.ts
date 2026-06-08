import { Injectable } from "@nestjs/common";
import {
  type Kpi,
  type MetricsDto,
  type MetricsRange,
  RANGE_DAYS,
  type TopTag,
} from "@dentaltrack/shared";
import { PrismaService } from "../prisma/prisma.service";

/** Janela fixa das "Mensagens do bot" (requisito do produto — context.md §10). */
const BOT_WINDOW_DAYS = 50;
/** Pontos no sparkline dos KPIs. */
const SPARK_POINTS = 12;

/** Mensagem mínima usada nas análises de conversa. */
interface ConvoLite {
  status: "em_andamento" | "agendada" | "abandonada";
  createdAt: Date;
  messages: { role: string; createdAt: Date }[];
}

/** Estatísticas de uma janela de tempo (reusadas para o período e o anterior). */
interface WindowStats {
  leadDates: Date[];
  conversations: ConvoLite[];
  started: number;
  engaged: number;
  scheduled: number;
  byStatus: Record<"em_andamento" | "agendada" | "abandonada", number>;
}

/**
 * Métricas do dashboard (BE-3.2/3.3). Escopado por `clinicId`. Definições em
 * docs/context.md §10. Calcula KPIs (com delta vs. janela anterior + sparkline),
 * séries (linha bot×paciente/dia), funil, top tags e distribuição de status.
 * Tudo ao vivo no MVP (a pré-agregação `daily_metric` é alimentada pela cron).
 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(clinicId: string, range: MetricsRange): Promise<MetricsDto> {
    const days = RANGE_DAYS[range];
    const today0 = startOfDay(new Date());
    const since = addDays(today0, -(days - 1));
    const prevSince = addDays(since, -days);
    const since50 = addDays(today0, -(BOT_WINDOW_DAYS - 1));
    const prev50Since = addDays(since50, -BOT_WINDOW_DAYS);

    const [cur, prev, botMsgs, prevBot, lineMsgs, topTags] = await Promise.all([
      this.windowStats(clinicId, since, null),
      this.windowStats(clinicId, prevSince, since),
      this.countAssistant(clinicId, since50, null),
      this.countAssistant(clinicId, prev50Since, since50),
      this.prisma.message.findMany({
        where: { clinicId, role: { in: ["user", "assistant"] }, createdAt: { gte: since } },
        select: { role: true, createdAt: true },
      }),
      this.topTags(clinicId, since),
    ]);

    // Sparklines: tendência diária no período (decorativa — downsample p/ 12 pts).
    const leadsSpark = downsample(bucketDaily(cur.leadDates, since, days), SPARK_POINTS);
    const botDaily = bucketDaily(
      lineMsgs.filter((m) => m.role === "assistant").map((m) => m.createdAt),
      since,
      days,
    );
    const patientDaily = bucketDaily(
      lineMsgs.filter((m) => m.role === "user").map((m) => m.createdAt),
      since,
      days,
    );
    const engagedSpark = downsample(
      bucketDaily(cur.conversations.filter(isEngaged).map((c) => c.createdAt), since, days),
      SPARK_POINTS,
    );
    const scheduledSpark = downsample(
      bucketDaily(
        cur.conversations.filter((c) => c.status === "agendada").map((c) => c.createdAt),
        since,
        days,
      ),
      SPARK_POINTS,
    );

    const responseRate = cur.started > 0 ? cur.engaged / cur.started : 0;
    const prevResponseRate = prev.started > 0 ? prev.engaged / prev.started : 0;
    const conversionRate = cur.started > 0 ? cur.scheduled / cur.started : 0;
    const prevConversionRate = prev.started > 0 ? prev.scheduled / prev.started : 0;

    const kpis: MetricsDto["kpis"] = {
      leads: kpi(cur.leadDates.length, prev.leadDates.length, downsample(bucketDaily(cur.leadDates, since, days), SPARK_POINTS)),
      botMessages: kpi(botMsgs, prevBot, downsample(botDaily, SPARK_POINTS)),
      responseRate: kpi(responseRate, prevResponseRate, engagedSpark),
      conversionRate: kpi(conversionRate, prevConversionRate, scheduledSpark),
      inProgress: kpi(cur.byStatus.em_andamento, null, []),
      notCompleted: kpi(cur.byStatus.abandonada, null, []),
    };
    // Evita recomputar o sparkline de leads (já calculado acima).
    kpis.leads.spark = leadsSpark;

    const labels = Array.from({ length: days }, (_, i) => formatDay(addDays(since, i)));

    return {
      range,
      kpis,
      line: { labels, bot: botDaily, patient: patientDaily },
      funnel: { started: cur.started, engaged: cur.engaged, scheduled: cur.scheduled },
      topTags,
      statusDistribution: [
        { status: "em_andamento", value: cur.byStatus.em_andamento },
        { status: "agendada", value: cur.byStatus.agendada },
        { status: "abandonada", value: cur.byStatus.abandonada },
      ],
    };
  }

  /** Estatísticas de conversas + leads numa janela [since, until) (until null = agora). */
  private async windowStats(
    clinicId: string,
    since: Date,
    until: Date | null,
  ): Promise<WindowStats> {
    const range = until ? { gte: since, lt: until } : { gte: since };
    const [leads, conversations] = await Promise.all([
      this.prisma.lead.findMany({
        where: { clinicId, createdAt: range },
        select: { createdAt: true },
      }),
      this.prisma.conversation.findMany({
        where: { clinicId, createdAt: range },
        select: {
          status: true,
          createdAt: true,
          messages: { select: { role: true, createdAt: true }, orderBy: { createdAt: "asc" } },
        },
      }),
    ]);

    const convos = conversations as ConvoLite[];
    const byStatus = { em_andamento: 0, agendada: 0, abandonada: 0 };
    let engaged = 0;
    let scheduled = 0;
    for (const c of convos) {
      byStatus[c.status] += 1;
      if (c.status === "agendada") scheduled += 1;
      if (isEngaged(c)) engaged += 1;
    }

    return {
      leadDates: leads.map((l) => l.createdAt),
      conversations: convos,
      started: convos.length,
      engaged,
      scheduled,
      byStatus,
    };
  }

  /** Conta mensagens do bot (role=assistant) numa janela. */
  private countAssistant(clinicId: string, since: Date, until: Date | null): Promise<number> {
    return this.prisma.message.count({
      where: {
        clinicId,
        role: "assistant",
        createdAt: until ? { gte: since, lt: until } : { gte: since },
      },
    });
  }

  /** Top 5 tags por frequência (conversation_tag) no período, com a cor fixa. */
  private async topTags(clinicId: string, since: Date): Promise<TopTag[]> {
    const grouped = await this.prisma.conversationTag.groupBy({
      by: ["tagId"],
      where: { clinicId, createdAt: { gte: since } },
      _count: { tagId: true },
      orderBy: { _count: { tagId: "desc" } },
      take: 5,
    });
    if (grouped.length === 0) return [];

    const tags = await this.prisma.tag.findMany({
      where: { id: { in: grouped.map((g) => g.tagId) } },
      select: { id: true, name: true, color: true },
    });
    const byId = new Map(tags.map((t) => [t.id, t]));
    return grouped
      .map((g) => {
        const t = byId.get(g.tagId);
        return t ? { name: t.name, color: t.color, value: g._count.tagId } : null;
      })
      .filter((t): t is TopTag => t !== null);
  }
}

/** Uma conversa "engajou" se o paciente respondeu após a 1ª mensagem do bot. */
function isEngaged(c: ConvoLite): boolean {
  const firstAssistant = c.messages.find((m) => m.role === "assistant");
  if (!firstAssistant) return false;
  return c.messages.some(
    (m) => m.role === "user" && m.createdAt.getTime() > firstAssistant.createdAt.getTime(),
  );
}

/** Monta um KPI com delta % vs. janela anterior (null quando não há base). */
function kpi(value: number, prev: number | null, spark: number[]): Kpi {
  if (prev == null || prev <= 0) {
    return { value, delta: null, deltaDir: null, spark };
  }
  const change = Math.round(((value - prev) / prev) * 100);
  return { value, delta: Math.abs(change), deltaDir: change >= 0 ? "up" : "down", spark };
}

/** Conta itens por dia numa janela de `days` dias a partir de `since`. */
function bucketDaily(dates: Date[], since: Date, days: number): number[] {
  const buckets = new Array<number>(days).fill(0);
  const start = startOfDay(since).getTime();
  for (const d of dates) {
    const idx = Math.floor((startOfDay(d).getTime() - start) / DAY_MS);
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

/** Reduz uma série a `target` pontos (média por balde), preservando a tendência. */
function downsample(arr: number[], target: number): number[] {
  if (arr.length <= target) return arr;
  const out: number[] = [];
  const size = arr.length / target;
  for (let i = 0; i < target; i++) {
    const slice = arr.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    const sum = slice.reduce((a, b) => a + b, 0);
    out.push(slice.length ? Math.round((sum / slice.length) * 10) / 10 : 0);
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Rótulo curto do eixo X (dd/MM). */
function formatDay(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
