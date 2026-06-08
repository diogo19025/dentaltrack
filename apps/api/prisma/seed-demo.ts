import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Seed de **demonstração** (F3) — popula a clínica demo com ~50 dias de
 * conversas sintéticas (mensagens, leads, agendamentos e tags) para o
 * dashboard/leads renderizarem com volume realista. SEPARADO do catálogo
 * (`db:seed`), que deve rodar antes (tags/procedimentos/settings).
 *
 * Idempotente: limpa os dados de conversa da clínica demo e recria. Não toca em
 * catálogo, tags, settings nem em outras clínicas.
 *
 * Rodar: pnpm --filter @dentaltrack/api db:seed:demo  (requer DATABASE_URL).
 */

const DEMO_CLINIC_ID = "00000000-0000-0000-0000-0000000c1141";

interface Scenario {
  procedureId: string;
  tagId: string;
  procedure: string;
  userText: string;
  reply: string;
}

const SCENARIOS: Scenario[] = [
  {
    procedureId: "00000000-0000-0000-0000-00000000d001",
    tagId: "00000000-0000-0000-0000-00000000e001",
    procedure: "Implante dentário",
    userText: "Olá! Perdi um dente e gostaria de saber sobre implante.",
    reply: "Claro! O implante repõe o dente perdido com um pino de titânio e coroa. Posso te explicar e já agendar uma avaliação. Como é seu nome?",
  },
  {
    procedureId: "00000000-0000-0000-0000-00000000d002",
    tagId: "00000000-0000-0000-0000-00000000e002",
    procedure: "Clareamento dental",
    userText: "Meus dentes estão amarelados, queria fazer um clareamento.",
    reply: "Temos clareamento estético que deixa o sorriso bem mais branco. Posso te passar os detalhes e agendar uma avaliação. Qual seu nome?",
  },
  {
    procedureId: "00000000-0000-0000-0000-00000000d003",
    tagId: "00000000-0000-0000-0000-00000000e003",
    procedure: "Ortodontia (aparelho)",
    userText: "Quero alinhar meus dentes com aparelho.",
    reply: "Ótimo! Trabalhamos com aparelho fixo e alinhadores. Uma avaliação define a melhor opção pra você. Como você se chama?",
  },
  {
    procedureId: "00000000-0000-0000-0000-00000000d004",
    tagId: "00000000-0000-0000-0000-00000000e005",
    procedure: "Limpeza (profilaxia)",
    userText: "Faz tempo que não faço uma limpeza, queria marcar.",
    reply: "Perfeito! A limpeza remove placa e tártaro e deixa tudo em dia. Posso agendar pra você. Qual seu nome?",
  },
  {
    procedureId: "00000000-0000-0000-0000-00000000d005",
    tagId: "00000000-0000-0000-0000-00000000e004",
    procedure: "Urgência / dor",
    userText: "Estou com muita dor de dente, é urgente.",
    reply: "Sinto muito! Atendemos urgências. Vou priorizar seu atendimento — me diga seu nome e telefone para encaixar o quanto antes.",
  },
];

const NAMES = [
  "Ana Souza", "Bruno Lima", "Carla Mendes", "Diego Alves", "Eduarda Rocha",
  "Felipe Castro", "Gabriela Dias", "Henrique Pinto", "Isabela Nunes", "João Ribeiro",
  "Karina Melo", "Lucas Faria", "Mariana Costa", "Nathan Gomes", "Olívia Barros",
  "Paulo Tavares", "Renata Lopes", "Sérgio Moraes", "Tatiane Cruz", "Vinícius Araújo",
];
const DDDS = ["11", "21", "31", "41", "47", "51", "61", "71", "85"];

const rint = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[rint(0, arr.length - 1)];
const phone = () => `(${pick(DDDS)}) 9${rint(1000, 9999)}-${rint(1000, 9999)}`;

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

interface Msg {
  role: "user" | "assistant";
  content: string;
  at: Date;
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
  const prisma = new PrismaClient({ adapter });

  try {
    const clinic = await prisma.clinic.findUnique({ where: { id: DEMO_CLINIC_ID } });
    if (!clinic) {
      throw new Error("Clínica demo não encontrada — rode `db:seed` (catálogo) antes do demo.");
    }

    // Limpa dados de conversa anteriores (mantém catálogo/tags/settings).
    await prisma.conversationTag.deleteMany({ where: { clinicId: DEMO_CLINIC_ID } });
    await prisma.appointment.deleteMany({ where: { clinicId: DEMO_CLINIC_ID } });
    await prisma.message.deleteMany({ where: { clinicId: DEMO_CLINIC_ID } });
    await prisma.conversation.deleteMany({ where: { clinicId: DEMO_CLINIC_ID } });
    await prisma.lead.deleteMany({ where: { clinicId: DEMO_CLINIC_ID } });

    const TOTAL = 90;
    let scheduled = 0;
    let engaged = 0;
    let abandoned = 0;

    for (let i = 0; i < TOTAL; i++) {
      const r = Math.random();
      const status = r < 0.32 ? "agendada" : r < 0.7 ? "em_andamento" : "abandonada";
      // "em andamento" ficam nas últimas ~18h (sobrevivem ao cron de abandono de
      // 24h); agendadas/abandonadas (terminais) se espalham por ~50 dias.
      let start: Date;
      if (status === "em_andamento") {
        start = new Date(Date.now() - rint(1, 18) * HOUR_MS - rint(0, 59) * MIN_MS);
      } else {
        const day = new Date();
        day.setHours(0, 0, 0, 0);
        day.setDate(day.getDate() - rint(1, 49));
        start = new Date(day.getTime() + rint(9, 18) * HOUR_MS + rint(0, 59) * MIN_MS);
      }
      const scenario = pick(SCENARIOS);

      const lead = await prisma.lead.create({
        data: { clinicId: DEMO_CLINIC_ID, name: pick(NAMES), phone: phone(), source: "web", createdAt: start },
      });

      // Roteiro de mensagens (abandonada = paciente não responde de volta).
      const msgs: Msg[] = [];
      let t = start.getTime();
      msgs.push({ role: "user", content: scenario.userText, at: new Date(t) });
      t += rint(1, 3) * MIN_MS;
      msgs.push({ role: "assistant", content: scenario.reply, at: new Date(t) });

      const engages = status !== "abandonada";
      if (engages) {
        t += rint(2, 6) * MIN_MS;
        msgs.push({ role: "user", content: "Perfeito! E como faço para agendar?", at: new Date(t) });
        t += rint(1, 3) * MIN_MS;
        msgs.push({
          role: "assistant",
          content: "Posso agendar sua avaliação. Qual o melhor dia e horário para você?",
          at: new Date(t),
        });
        if (status === "agendada") {
          t += rint(2, 5) * MIN_MS;
          msgs.push({ role: "user", content: "Pode ser na próxima terça de manhã.", at: new Date(t) });
          t += rint(1, 2) * MIN_MS;
          msgs.push({
            role: "assistant",
            content: "Agendado! Sua avaliação está marcada. Qualquer dúvida, é só chamar. Até lá!",
            at: new Date(t),
          });
        }
      }

      const lastAt = msgs[msgs.length - 1].at;
      const convo = await prisma.conversation.create({
        data: {
          clinicId: DEMO_CLINIC_ID,
          leadId: lead.id,
          channel: "web",
          status,
          createdAt: start,
          lastMessageAt: lastAt,
        },
      });

      await prisma.message.createMany({
        data: msgs.map((m) => ({
          clinicId: DEMO_CLINIC_ID,
          conversationId: convo.id,
          role: m.role,
          content: m.content,
          createdAt: m.at,
          tokens: m.role === "assistant" ? rint(40, 180) : null,
        })),
      });

      // Tag principal (sempre) + secundária (eventual) — alimenta top tags.
      await prisma.conversationTag.create({
        data: {
          clinicId: DEMO_CLINIC_ID,
          conversationId: convo.id,
          tagId: scenario.tagId,
          confidence: rint(72, 96) / 100,
          createdAt: lastAt,
        },
      });
      if (Math.random() < 0.22) {
        const other = pick(SCENARIOS);
        if (other.tagId !== scenario.tagId) {
          await prisma.conversationTag.create({
            data: {
              clinicId: DEMO_CLINIC_ID,
              conversationId: convo.id,
              tagId: other.tagId,
              confidence: rint(55, 78) / 100,
              createdAt: lastAt,
            },
          });
        }
      }

      if (status === "agendada") {
        await prisma.appointment.create({
          data: {
            clinicId: DEMO_CLINIC_ID,
            conversationId: convo.id,
            leadId: lead.id,
            procedureId: scenario.procedureId,
            preferredTime: "Próxima terça de manhã",
            createdAt: lastAt,
          },
        });
        scheduled += 1;
      }
      if (engages) engaged += 1;
      if (status === "abandonada") abandoned += 1;
    }

    console.log(
      `✔ Demo populada: ${TOTAL} conversas (engajadas≈${engaged}, agendadas=${scheduled}, abandonadas=${abandoned}) ao longo de ~50 dias.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Falha no seed demo:", err);
  process.exit(1);
});
