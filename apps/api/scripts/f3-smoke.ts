import "dotenv/config";
import { LeadsService } from "../src/leads/leads.service";
import { MetricsService } from "../src/metrics/metrics.service";
import { PrismaService } from "../src/prisma/prisma.service";

/**
 * Smoke da F3 contra o banco real (read-only): roda o `MetricsService` e o
 * `LeadsService` da clínica demo e imprime os payloads do dashboard/leads.
 * Prova a pipeline (auto-tagging → métricas/leads) ponta a ponta no Supabase.
 *
 * Rodar: pnpm --filter @dentaltrack/api db:smoke:f3  (requer DATABASE_URL + db:seed:demo).
 */

const DEMO = "00000000-0000-0000-0000-0000000c1141";

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const [conversations, messages, leads, appointments, conversationTags] = await Promise.all([
      prisma.conversation.count({ where: { clinicId: DEMO } }),
      prisma.message.count({ where: { clinicId: DEMO } }),
      prisma.lead.count({ where: { clinicId: DEMO } }),
      prisma.appointment.count({ where: { clinicId: DEMO } }),
      prisma.conversationTag.count({ where: { clinicId: DEMO } }),
    ]);
    console.log("Contagens (demo):", {
      conversations,
      messages,
      leads,
      appointments,
      conversationTags,
    });

    const m = await new MetricsService(prisma).getMetrics(DEMO, "50d");
    console.log("\nKPIs:", {
      leads: m.kpis.leads.value,
      botMessages: m.kpis.botMessages.value,
      responseRate: `${Math.round(m.kpis.responseRate.value * 100)}%`,
      conversionRate: `${Math.round(m.kpis.conversionRate.value * 100)}%`,
      inProgress: m.kpis.inProgress.value,
      notCompleted: m.kpis.notCompleted.value,
    });
    console.log("Funil:", m.funnel);
    console.log("Status:", m.statusDistribution.map((s) => `${s.status}=${s.value}`).join(" · "));
    console.log("Top tags:", m.topTags.map((t) => `${t.name}=${t.value}`).join(" · "));
    console.log(
      "Linha:",
      `${m.line.labels.length} pontos · bot=${m.line.bot.reduce((a, b) => a + b, 0)} · paciente=${m.line.patient.reduce((a, b) => a + b, 0)}`,
    );

    const leadsRes = await new LeadsService(prisma).list(DEMO);
    console.log("\nLeads resumo:", leadsRes.summary);
    const first = leadsRes.leads[0];
    if (first) {
      console.log("Lead exemplo:", {
        name: first.name,
        interest: first.interest,
        status: first.status,
        tags: first.tags.map((t) => t.name),
      });
    }
    console.log("\n✔ F3 smoke OK.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Falha no F3 smoke:", err);
  process.exit(1);
});
