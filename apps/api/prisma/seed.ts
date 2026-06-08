import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Seed da base (BE-2.4, antecipado para a base mínima da F1):
 * uma clínica demo + catálogo de procedimentos odontológicos.
 * Idempotente — usa IDs fixos e `upsert`, pode rodar várias vezes.
 *
 * Rodar: pnpm --filter @dentaltrack/api db:seed  (requer DATABASE_URL).
 */

// IDs fixos para idempotência (DEMO).
const DEMO_CLINIC_ID = "00000000-0000-0000-0000-0000000c1141";

interface SeedProcedure {
  id: string;
  name: string;
  description: string;
  priceMinCents: number;
  priceMaxCents: number;
  durationMinutes: number;
}

const PROCEDURES: SeedProcedure[] = [
  {
    id: "00000000-0000-0000-0000-00000000d001",
    name: "Implante dentário",
    description:
      "Reposição de dente perdido com pino de titânio e coroa. Inclui avaliação e planejamento.",
    priceMinCents: 150000,
    priceMaxCents: 350000,
    durationMinutes: 90,
  },
  {
    id: "00000000-0000-0000-0000-00000000d002",
    name: "Clareamento dental",
    description: "Clareamento estético a laser ou com moldeira para um sorriso mais branco.",
    priceMinCents: 50000,
    priceMaxCents: 120000,
    durationMinutes: 60,
  },
  {
    id: "00000000-0000-0000-0000-00000000d003",
    name: "Ortodontia (aparelho)",
    description: "Correção do alinhamento dos dentes com aparelho fixo ou alinhadores.",
    priceMinCents: 200000,
    priceMaxCents: 600000,
    durationMinutes: 60,
  },
  {
    id: "00000000-0000-0000-0000-00000000d004",
    name: "Limpeza (profilaxia)",
    description: "Remoção de placa e tártaro, polimento e orientação de higiene bucal.",
    priceMinCents: 15000,
    priceMaxCents: 30000,
    durationMinutes: 45,
  },
  {
    id: "00000000-0000-0000-0000-00000000d005",
    name: "Urgência / dor",
    description: "Atendimento de urgência para dor de dente, abscesso ou trauma.",
    priceMinCents: 10000,
    priceMaxCents: 40000,
    durationMinutes: 30,
  },
];

interface SeedTag {
  id: string;
  name: string;
  color: "teal" | "violet" | "amber" | "blue" | "rose" | "sage";
  category: string;
  keywords: string[];
}

const TAGS: SeedTag[] = [
  {
    id: "00000000-0000-0000-0000-00000000e001",
    name: "implante",
    color: "teal",
    category: "Procedimento",
    keywords: ["implante", "dente perdido", "perdi um dente"],
  },
  {
    id: "00000000-0000-0000-0000-00000000e002",
    name: "clareamento",
    color: "amber",
    category: "Estética",
    keywords: ["clarear", "clareamento", "branquear", "dente amarelo"],
  },
  {
    id: "00000000-0000-0000-0000-00000000e003",
    name: "ortodontia",
    color: "blue",
    category: "Procedimento",
    keywords: ["aparelho", "alinhar", "dentes tortos", "ortodontia"],
  },
  {
    id: "00000000-0000-0000-0000-00000000e004",
    name: "urgência",
    color: "rose",
    category: "Urgência",
    keywords: ["dor", "urgência", "quebrou", "inchado", "sangramento"],
  },
  {
    id: "00000000-0000-0000-0000-00000000e005",
    name: "limpeza",
    color: "sage",
    category: "Prevenção",
    keywords: ["limpeza", "tártaro", "profilaxia", "placa"],
  },
];

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
  const prisma = new PrismaClient({ adapter });

  try {
    const clinic = await prisma.clinic.upsert({
      where: { id: DEMO_CLINIC_ID },
      update: { name: "Clínica DentalTrack (Demo)" },
      create: { id: DEMO_CLINIC_ID, name: "Clínica DentalTrack (Demo)" },
    });
    console.log(`✔ Clínica demo: ${clinic.name} (${clinic.id})`);

    for (const proc of PROCEDURES) {
      await prisma.procedure.upsert({
        where: { id: proc.id },
        update: {
          name: proc.name,
          description: proc.description,
          priceMinCents: proc.priceMinCents,
          priceMaxCents: proc.priceMaxCents,
          durationMinutes: proc.durationMinutes,
          active: true,
        },
        create: { clinicId: clinic.id, ...proc },
      });
      console.log(`  ↳ procedimento: ${proc.name}`);
    }

    await prisma.clinicSettings.upsert({
      where: { clinicId: clinic.id },
      update: {},
      create: {
        clinicId: clinic.id,
        specialty: "odontologia geral e estética",
        description: "Clínica odontológica focada em atendimento acolhedor e procedimentos estéticos.",
        assistantName: "Sofia",
        tone: "acolhedor",
        greeting: "Olá! Sou a Sofia, assistente virtual da clínica. Como posso ajudar seu sorriso hoje?",
        instructions: "Ofereça sempre uma avaliação inicial antes de orçar procedimentos.",
        offerEnabled: true,
        offerText: "Avaliação inicial gratuita durante o mês de junho para novos pacientes.",
        offerStartsOn: "01/06/2026",
        offerEndsOn: "30/06/2026",
        availability: [
          { day: "Segunda a sexta", hours: "08:00 – 18:00", open: true },
          { day: "Sábado", hours: "08:00 – 12:00", open: true },
          { day: "Domingo", hours: "Fechado", open: false },
        ],
      },
    });
    console.log("  ↳ configurações (persona + oferta) da clínica demo");

    for (const tag of TAGS) {
      await prisma.tag.upsert({
        where: { id: tag.id },
        update: {
          name: tag.name,
          color: tag.color,
          category: tag.category,
          keywords: tag.keywords,
        },
        create: { clinicId: clinic.id, ...tag },
      });
      console.log(`  ↳ tag: ${tag.name}`);
    }

    console.log(
      `✔ Seed concluído: ${PROCEDURES.length} procedimentos + ${TAGS.length} tags + settings.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Falha no seed:", err);
  process.exit(1);
});
