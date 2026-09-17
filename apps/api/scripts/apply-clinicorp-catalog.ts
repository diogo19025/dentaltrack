import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import type { TagColor } from "@dentaltrack/shared";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Substitui o catálogo demo de UMA clínica pelo que a conta dela no Clinicorp
 * usa de verdade:
 *
 * - **procedimentos** ← `GET /procedures/list` (tabela de preços da conta);
 * - **tags** ← especialidades da odontologia que os procedimentos da conta
 *   cobrem (o Clinicorp não tem "tag"; a especialidade é o conceito mais
 *   próximo, e é o que serve ao auto-tagging), com palavras-chave em PT-BR;
 * - **tradução de status** ← `GET /appointment/status_list`, já com a
 *   sugestão gravada na integração para o operador só confirmar na tela.
 *
 * Categorias de agenda (Cirurgia/Periódico/Avaliação/Retorno/Consulta) não
 * têm equivalente aqui e ficam de fora. Sem `--apply` só imprime o que faria.
 * Requer DATABASE_URL, RESET_CLINIC_ID, CLINICORP_USERNAME e CLINICORP_TOKEN.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const C = process.env.RESET_CLINIC_ID!;
const APPLY = process.argv.includes("--apply");
const U = process.env.CLINICORP_USERNAME!;
const T = process.env.CLINICORP_TOKEN!;
const BASE = "https://api.clinicorp.com/rest/v1";

interface TagPlan {
  name: string;
  color: TagColor;
  keywords: string[];
  /** procedimentos do Clinicorp que entram nesta tag */
  match: RegExp | null;
}

/** Especialidades da conta que os procedimentos cobrem, mais as duas que a clínica criou. */
const TAGS: TagPlan[] = [
  { name: "Ortodontia", color: "blue", keywords: ["aparelho", "ortodontia", "alinhador", "contenção", "dentes tortos", "invisalign"], match: /ortod|contenção/i },
  { name: "Prótese", color: "violet", keywords: ["prótese", "coroa", "dentadura", "ppr", "pivô", "placa de mordida", "bruxismo"], match: /prótese|coroa|placa de mordida/i },
  { name: "Dentística", color: "amber", keywords: ["restauração", "obturação", "clareamento", "faceta", "cárie", "lente de contato"], match: /restauração|clareamento|faceta/i },
  { name: "Endodontia", color: "rose", keywords: ["canal", "tratamento de canal", "endodontia", "dor de dente", "nervo"], match: /endodôntico/i },
  { name: "Cirurgia", color: "teal", keywords: ["extração", "exodontia", "siso", "implante", "frenectomia", "gengivectomia", "cirurgia"], match: /exodontia|frenulectonia|frenectomia|gengivectomia|implante/i },
  { name: "Periodontia", color: "sage", keywords: ["gengiva", "sangramento", "raspagem", "limpeza", "tártaro", "profilaxia", "periodontia"], match: /raspagem|limpeza/i },
  { name: "Radiologia", color: "blue", keywords: ["radiografia", "raio-x", "raio x", "panorâmica", "periapical"], match: /radiografia/i },
  { name: "Emergência", color: "rose", keywords: ["urgência", "emergência", "dor", "quebrou", "inchaço", "inchado", "abscesso"], match: null },
  { name: "Harmonização Orofacial", color: "violet", keywords: ["harmonização", "botox", "toxina", "preenchimento", "ácido hialurônico", "bichectomia"], match: null },
  { name: "Prevenção", color: "sage", keywords: ["prevenção", "check-up", "revisão", "consulta de rotina", "avaliação"], match: /limpeza/i },
];

/** Tradução sugerida dos status da conta (o operador confirma na tela). */
const STATUS_RULES: Array<{ test: RegExp; status: string | null }> = [
  { test: /falt|não compareceu/i, status: "faltou" },
  { test: /cancel|desmarc/i, status: "cancelado" },
  { test: /atendid|em atendimento|espera/i, status: "compareceu" },
  { test: /confirmad/i, status: "confirmado" },
];

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}subscriber_id=${U}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${U}:${T}`).toString("base64")}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  if (!C || !U || !T) throw new Error("Faltam RESET_CLINIC_ID / CLINICORP_USERNAME / CLINICORP_TOKEN");
  const clinic = await prisma.clinic.findUnique({
    where: { id: C },
    select: { name: true, settings: { select: { specialty: true } } },
  });
  if (!clinic) throw new Error(`Clínica ${C} não existe`);

  // --- procedimentos
  const priceLists = await api<Record<string, Array<{ ProcedureName: string; ProcedureExpertiseName: string; Type: string }>>>("/procedures/list");
  const seen = new Map<string, { name: string; expertise: string }>();
  for (const items of Object.values(priceLists)) {
    for (const p of items) {
      const key = p.ProcedureName.trim().toLowerCase();
      if (p.Type === "PROCEDURE" && !seen.has(key)) seen.set(key, { name: p.ProcedureName.trim(), expertise: p.ProcedureExpertiseName });
    }
  }
  const procedures = [...seen.values()].map((p) => ({
    ...p,
    // nomes vêm com caixa inconsistente ("limpeza"); primeira letra maiúscula
    name: p.name.charAt(0).toUpperCase() + p.name.slice(1),
    tags: TAGS.filter((t) => t.match?.test(p.name)).map((t) => t.name),
  }));

  // --- status
  type Status = { id: number; Description: string; Active?: string; Type?: string };
  const rawStatuses = await api<Status[] | Record<string, Status[]>>("/appointment/status_list");
  // A rota embrulha a lista num objeto ({ status: [...] }); aceita as duas formas.
  const statuses = Array.isArray(rawStatuses)
    ? rawStatuses
    : (Object.values(rawStatuses).find((v) => Array.isArray(v)) as Status[] | undefined) ?? [];
  const statusMappings = statuses
    .filter((s) => !s.Active || s.Active === "X")
    .map((s) => ({
      externalId: String(s.id),
      externalName: s.Description,
      status: STATUS_RULES.find((r) => r.test.test(s.Description))?.status ?? null,
    }));

  const before = {
    procedures: (await prisma.procedure.findMany({ where: { clinicId: C }, select: { name: true } })).map((p) => p.name),
    tags: (await prisma.tag.findMany({ where: { clinicId: C }, select: { name: true } })).map((t) => t.name),
    conversationTags: await prisma.conversationTag.count({ where: { clinicId: C } }),
    specialty: clinic.settings?.specialty ?? null,
  };

  console.log(`${APPLY ? "APLICANDO" : "SIMULAÇÃO"} — clínica "${clinic.name}" (${C})`);
  console.log("remover procedimentos:", before.procedures);
  console.log("remover tags:", before.tags, `(e ${before.conversationTags} tag(s) de conversa presas a elas)`);
  console.log(`\ncriar ${TAGS.length} tags (especialidades):`);
  for (const t of TAGS) console.log(`  - ${t.name} [${t.color}] ← ${t.keywords.join(", ")}`);
  console.log(`\ncriar ${procedures.length} procedimentos do Clinicorp:`);
  for (const p of procedures) console.log(`  - ${p.name}${p.tags.length ? " → " + p.tags.join(", ") : ""}`);
  console.log("\ntradução de status gravada na integração (confirmar na tela):");
  for (const m of statusMappings) console.log(`  - ${m.externalName} → ${m.status ?? "(ignorar)"}`);
  console.log(`\nespecialidade da clínica: ${before.specialty ?? "(vazia)"} → ${before.specialty ?? "Odontologia"}`);
  if (!APPLY) {
    console.log("\nSimulação. Rode com --apply para executar.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.conversationTag.deleteMany({ where: { clinicId: C } });
    await tx.procedure.deleteMany({ where: { clinicId: C } });
    await tx.tag.deleteMany({ where: { clinicId: C } });
    const tagIds = new Map<string, string>();
    for (const t of TAGS) {
      const created = await tx.tag.create({
        data: { clinicId: C, name: t.name, color: t.color, category: "especialidade", keywords: t.keywords },
        select: { id: true },
      });
      tagIds.set(t.name, created.id);
    }
    for (const p of procedures) {
      await tx.procedure.create({
        data: {
          clinicId: C,
          name: p.name,
          description: `Especialidade no Clinicorp: ${p.expertise}`,
          active: true,
          tags: { connect: p.tags.map((name) => ({ id: tagIds.get(name)! })) },
        },
      });
    }
    await tx.clinicIntegration.updateMany({
      where: { clinicId: C, provider: "clinicorp" },
      data: { statusMappings, unitId: null, professionalId: null },
    });
    if (!before.specialty) {
      await tx.clinicSettings.update({ where: { clinicId: C }, data: { specialty: "Odontologia" } });
    }
  }, { timeout: 120_000, maxWait: 15_000 });
  console.log("feito.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
