import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Remove **só o que o `prisma/seed-demo.ts` criou** numa clínica: leads com
 * DDD 00 (a marca deliberada do seed) e tudo o que pende deles — conversas,
 * mensagens, tags de conversa, agendamentos, cards do funil, fila de saída e
 * opt-outs — mais a coluna "Pós-atendimento" que o seed cria como exemplo, se
 * ficar vazia. O que não veio do seed (contatos reais, leads do Clinicorp,
 * catálogo, tags, colunas padrão, feriados, configurações) fica intacto.
 *
 * Sem `--apply` só imprime o que faria. Requer DATABASE_URL e RESET_CLINIC_ID.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const C = process.env.RESET_CLINIC_ID!;
const APPLY = process.argv.includes("--apply");

/** Telefone do seed: "(00) 9xxxx-xxxx" no lead, "5500…" normalizado. */
const DEMO_LEAD_PHONE = /^\(00\) 9\d{4}-\d{4}$/;

async function main() {
  if (!C) throw new Error("Falta RESET_CLINIC_ID");
  const clinic = await prisma.clinic.findUnique({ where: { id: C }, select: { name: true } });
  if (!clinic) throw new Error(`Clínica ${C} não existe`);

  const allLeads = await prisma.lead.findMany({ where: { clinicId: C }, select: { id: true, phone: true, name: true } });
  const demoLeadIds = allLeads.filter((l) => l.phone && DEMO_LEAD_PHONE.test(l.phone)).map((l) => l.id);
  const keptLeads = allLeads.filter((l) => !demoLeadIds.includes(l.id));

  const demoConvs = await prisma.conversation.findMany({
    where: { clinicId: C, OR: [{ leadId: { in: demoLeadIds } }, { contactPhone: { startsWith: "5500" } }] },
    select: { id: true },
  });
  const demoConvIds = demoConvs.map((c) => c.id);
  const demoAppts = await prisma.appointment.findMany({
    where: { clinicId: C, OR: [{ leadId: { in: demoLeadIds } }, { conversationId: { in: demoConvIds } }] },
    select: { id: true },
  });
  const demoApptIds = demoAppts.map((a) => a.id);

  const counts = {
    leads: demoLeadIds.length,
    conversations: demoConvIds.length,
    messages: await prisma.message.count({ where: { conversationId: { in: demoConvIds } } }),
    conversationTags: await prisma.conversationTag.count({ where: { conversationId: { in: demoConvIds } } }),
    appointments: demoApptIds.length,
    pipelineCards: await prisma.pipelineCard.count({
      where: { clinicId: C, OR: [{ leadId: { in: demoLeadIds } }, { conversationId: { in: demoConvIds } }] },
    }),
    outbound: await prisma.outboundMessage.count({
      where: { clinicId: C, OR: [{ phone: { startsWith: "5500" } }, { appointmentId: { in: demoApptIds } }] },
    }),
    optOuts: await prisma.contactOptOut.count({ where: { clinicId: C, phone: { startsWith: "5500" } } }),
  };
  const totals = {
    leads: allLeads.length,
    conversations: await prisma.conversation.count({ where: { clinicId: C } }),
    appointments: await prisma.appointment.count({ where: { clinicId: C } }),
    pipelineCards: await prisma.pipelineCard.count({ where: { clinicId: C } }),
    outbound: await prisma.outboundMessage.count({ where: { clinicId: C } }),
  };

  console.log(`${APPLY ? "APLICANDO" : "SIMULAÇÃO"} — clínica "${clinic.name}" (${C})`);
  console.log("apagar (do seed demo):", counts);
  console.log("totais antes:", totals);
  console.log(
    "leads que FICAM:",
    keptLeads.map((l) => `${l.name ?? "(sem nome)"} ${l.phone ? "…" + l.phone.slice(-4) : ""}`),
  );
  if (!APPLY) {
    console.log("\nSimulação. Rode com --apply para executar.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.outboundMessage.deleteMany({
      where: { clinicId: C, OR: [{ phone: { startsWith: "5500" } }, { appointmentId: { in: demoApptIds } }] },
    });
    await tx.contactOptOut.deleteMany({ where: { clinicId: C, phone: { startsWith: "5500" } } });
    await tx.pipelineCard.deleteMany({
      where: { clinicId: C, OR: [{ leadId: { in: demoLeadIds } }, { conversationId: { in: demoConvIds } }] },
    });
    await tx.conversationTag.deleteMany({ where: { conversationId: { in: demoConvIds } } });
    await tx.appointment.deleteMany({ where: { id: { in: demoApptIds } } });
    await tx.message.deleteMany({ where: { conversationId: { in: demoConvIds } } });
    await tx.conversation.deleteMany({ where: { id: { in: demoConvIds } } });
    await tx.lead.deleteMany({ where: { id: { in: demoLeadIds } } });
    // Coluna de exemplo do seed: só sai se não sobrou card nela.
    const custom = await tx.pipelineStage.findFirst({
      where: { clinicId: C, name: "Pós-atendimento" },
      select: { id: true, _count: { select: { cards: true } } },
    });
    if (custom && custom._count.cards === 0) {
      await tx.pipelineStage.delete({ where: { id: custom.id } });
      console.log('coluna "Pós-atendimento" (exemplo do seed) removida');
    }
  });
  console.log("feito.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
