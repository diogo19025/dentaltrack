import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { DEFAULT_AUTOMATION_SETTINGS } from "@dentaltrack/shared";
import { PrismaClient } from "../generated/prisma/client";
import { toRow as automationSettingsToRow } from "../src/automations/automation-settings.service";
import { MockAgendaProvider } from "../src/clinicorp/mock.provider";
import { suggestStatusMappings } from "../src/clinicorp/status-heuristics";

/**
 * Seed da base (BE-2.4): uma clínica demo + configurações (persona + oferta) +
 * catálogo de procedimentos odontológicos + tags de interesse, com as tags
 * associadas aos procedimentos (relação N:N — alimenta o suggestProcedures).
 * Desde a P1.2 também deixa a empresa **operacional**: automações com os
 * padrões de fábrica, agenda simulada ligada (com o mapeamento de status já
 * preenchido — é o que faz a /agenda demo ter conteúdo) e feriados.
 * Idempotente — usa IDs fixos e `upsert`, pode rodar várias vezes.
 *
 * Rodar: pnpm --filter @dentaltrack/api db:seed  (requer DATABASE_URL).
 */

// IDs fixos para idempotência (DEMO).
const DEMO_CLINIC_ID = "00000000-0000-0000-0000-0000000c1141";

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

interface SeedProcedure {
  id: string;
  name: string;
  description: string;
  priceMinCents: number;
  priceMaxCents: number;
  durationMinutes: number;
  /** Tag de interesse associada (id de TAGS). */
  tagId: string;
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
    tagId: "00000000-0000-0000-0000-00000000e001",
  },
  {
    id: "00000000-0000-0000-0000-00000000d002",
    name: "Clareamento dental",
    description: "Clareamento estético a laser ou com moldeira para um sorriso mais branco.",
    priceMinCents: 50000,
    priceMaxCents: 120000,
    durationMinutes: 60,
    tagId: "00000000-0000-0000-0000-00000000e002",
  },
  {
    id: "00000000-0000-0000-0000-00000000d003",
    name: "Ortodontia (aparelho)",
    description: "Correção do alinhamento dos dentes com aparelho fixo ou alinhadores.",
    priceMinCents: 200000,
    priceMaxCents: 600000,
    durationMinutes: 60,
    tagId: "00000000-0000-0000-0000-00000000e003",
  },
  {
    id: "00000000-0000-0000-0000-00000000d004",
    name: "Limpeza (profilaxia)",
    description: "Remoção de placa e tártaro, polimento e orientação de higiene bucal.",
    priceMinCents: 15000,
    priceMaxCents: 30000,
    durationMinutes: 45,
    tagId: "00000000-0000-0000-0000-00000000e005",
  },
  {
    id: "00000000-0000-0000-0000-00000000d005",
    name: "Urgência / dor",
    description: "Atendimento de urgência para dor de dente, abscesso ou trauma.",
    priceMinCents: 10000,
    priceMaxCents: 40000,
    durationMinutes: 30,
    tagId: "00000000-0000-0000-0000-00000000e004",
  },
];

/** Feriados nacionais de data fixa + o recesso da própria empresa (local). */
const HOLIDAYS: { md: string; name: string; scope: "nacional" | "local" }[] = [
  { md: "01-01", name: "Confraternização Universal", scope: "nacional" },
  { md: "04-21", name: "Tiradentes", scope: "nacional" },
  { md: "05-01", name: "Dia do Trabalho", scope: "nacional" },
  { md: "09-07", name: "Independência do Brasil", scope: "nacional" },
  { md: "10-12", name: "Nossa Senhora Aparecida", scope: "nacional" },
  { md: "11-02", name: "Finados", scope: "nacional" },
  { md: "11-15", name: "Proclamação da República", scope: "nacional" },
  { md: "11-20", name: "Dia da Consciência Negra", scope: "nacional" },
  { md: "12-25", name: "Natal", scope: "nacional" },
  { md: "12-24", name: "Recesso de fim de ano (véspera)", scope: "local" },
  { md: "12-31", name: "Recesso de fim de ano", scope: "local" },
];

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
  const prisma = new PrismaClient({ adapter });

  try {
    await assertDemoCatalogOwnership(prisma);
    const clinic = await prisma.clinic.upsert({
      where: { id: DEMO_CLINIC_ID },
      update: { name: "Clínica DentalTrack (Demo)" },
      create: { id: DEMO_CLINIC_ID, name: "Clínica DentalTrack (Demo)" },
    });
    console.log(`✔ Clínica demo: ${clinic.name} (${clinic.id})`);

    // Persona + oferta + disponibilidade da demo. Os mesmos dados vão em `create`
    // e `update` para o seed ser idempotente mesmo numa base já semeada na F1:
    // antes, `update: {}` deixava a demo sem os campos de oferta/disponibilidade
    // da F2 (a clinic_settings já existia, então nada era atualizado).
    const demoSettings = {
      specialty: "odontologia geral e estética",
      description:
        "Clínica odontológica focada em atendimento acolhedor e procedimentos estéticos.",
      assistantName: "Sofia",
      tone: "acolhedor",
      greeting:
        "Olá! Sou a Sofia, assistente virtual da clínica. Como posso ajudar seu sorriso hoje?",
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
    };
    await prisma.clinicSettings.upsert({
      where: { clinicId: clinic.id },
      update: demoSettings,
      create: { clinicId: clinic.id, ...demoSettings },
    });
    console.log("  ↳ configurações (persona + oferta) da clínica demo");

    // Tags antes dos procedimentos (para poder associá-las no upsert abaixo).
    for (const tag of TAGS) {
      await prisma.tag.upsert({
        where: { id: tag.id },
        update: { name: tag.name, color: tag.color, category: tag.category, keywords: tag.keywords },
        create: { clinicId: clinic.id, ...tag },
      });
      console.log(`  ↳ tag: ${tag.name}`);
    }

    for (const { tagId, ...proc } of PROCEDURES) {
      await prisma.procedure.upsert({
        where: { id: proc.id },
        update: {
          name: proc.name,
          description: proc.description,
          priceMinCents: proc.priceMinCents,
          priceMaxCents: proc.priceMaxCents,
          durationMinutes: proc.durationMinutes,
          active: true,
          tags: { set: [{ id: tagId }] },
        },
        create: { clinicId: clinic.id, ...proc, tags: { connect: [{ id: tagId }] } },
      });
      console.log(`  ↳ procedimento: ${proc.name}`);
    }

    // ── Operação (P1.2): automações, agenda simulada e feriados ──────────────

    // Automações com os padrões de fábrica. `update: {}` de propósito: o que
    // o operador da demo ajustou na aba não pode voltar ao padrão a cada seed.
    const automationRow = automationSettingsToRow(DEFAULT_AUTOMATION_SETTINGS);
    await prisma.automationSettings.upsert({
      where: { clinicId: clinic.id },
      update: {},
      create: { clinicId: clinic.id, ...automationRow },
    });
    console.log("  ↳ automações (padrões de fábrica)");

    // Agenda simulada ligada, com o mapeamento de status já preenchido pela
    // mesma heurística que a tela sugere ao operador. Sem o mapeamento a
    // sincronização ignora todo status e a /agenda fica vazia.
    const statuses = await new MockAgendaProvider(automationRow.timezone).listStatuses();
    const statusMappings = suggestStatusMappings(statuses);
    await prisma.clinicIntegration.upsert({
      where: { clinicId_provider: { clinicId: clinic.id, provider: "clinicorp" } },
      update: { mode: "mock", unitId: "1", professionalId: "10", statusMappings },
      create: {
        clinicId: clinic.id,
        provider: "clinicorp",
        mode: "mock",
        unitId: "1",
        professionalId: "10",
        statusMappings,
      },
    });
    // Só um provedor ativo por empresa: o Google fica explicitamente desligado.
    await prisma.clinicIntegration.updateMany({
      where: { clinicId: clinic.id, provider: "google" },
      data: { mode: "desligado" },
    });
    console.log(
      `  ↳ integração de agenda em modo simulado (${statusMappings.filter((m) => m.status).length}/${statusMappings.length} status mapeados)`,
    );

    // Feriados do ano corrente e do próximo: os nacionais fixos (os móveis
    // vêm da sincronização na aba) e um recesso local — é o local que a
    // fonte pública nunca conhece e que a demo precisa mostrar.
    let holidays = 0;
    const year = new Date().getFullYear();
    for (const y of [year, year + 1]) {
      for (const { md, name, scope } of HOLIDAYS) {
        const date = new Date(`${y}-${md}T00:00:00.000Z`);
        await prisma.holiday.upsert({
          where: { clinicId_date: { clinicId: clinic.id, date } },
          update: {},
          create: { clinicId: clinic.id, date, name, scope },
        });
        holidays += 1;
      }
    }
    console.log(`  ↳ ${holidays} feriados (${year}–${year + 1})`);

    console.log(
      `✔ Seed concluído: ${TAGS.length} tags + ${PROCEDURES.length} procedimentos (com tags) + settings + automações + agenda simulada + feriados.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Os IDs do catálogo são fixos para o seed ser idempotente. Falha fechado se
 * algum deles tiver sido usado por outro tenant: o `upsert({ where: { id } })`
 * não pode transformar uma colisão em escrita cross-tenant.
 */
async function assertDemoCatalogOwnership(prisma: PrismaClient): Promise<void> {
  const [foreignTag, foreignProcedure] = await Promise.all([
    prisma.tag.findFirst({
      where: {
        id: { in: TAGS.map((tag) => tag.id) },
        clinicId: { not: DEMO_CLINIC_ID },
      },
      select: { id: true, clinicId: true },
    }),
    prisma.procedure.findFirst({
      where: {
        id: { in: PROCEDURES.map((procedure) => procedure.id) },
        clinicId: { not: DEMO_CLINIC_ID },
      },
      select: { id: true, clinicId: true },
    }),
  ]);
  if (foreignTag || foreignProcedure) {
    throw new Error(
      "Seed abortado: um ID reservado da demo pertence a outra empresa.",
    );
  }
}

main().catch((err) => {
  console.error("Falha no seed:", err);
  process.exit(1);
});
