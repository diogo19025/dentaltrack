import "dotenv/config";
import {
  ClinicorpClient,
  CLINICORP_DEFAULT_BASE_URL,
} from "../src/clinicorp/clinicorp.client";
import { ClinicorpAgendaProvider } from "../src/clinicorp/clinicorp.provider";
import { suggestStatusMappings } from "../src/clinicorp/status-heuristics";

/**
 * Smoke do Clinicorp (F9) — **só leitura por padrão**, sem banco e sem a
 * aplicação.
 *
 * É o primeiro comando a rodar no dia em que a credencial do cliente chegar.
 * Ele percorre a cadeia inteira que as automações dependem e imprime o que cada
 * rota respondeu, para que a verdade sobre a API apareça em cinco minutos em
 * vez de aparecer depurando em produção.
 *
 * **A escrita é opt-in duplo** (P0.1): só acontece com `--write` **e**
 * `CLINICORP_WRITE_TEST=1`. O sistema do outro lado é o prontuário de uma
 * clínica de verdade, e um agendamento de teste criado por engano aparece na
 * tela da recepção. Duas travas, uma no comando e outra no ambiente, tornam o
 * acidente improvável — e o teste, possível no dia em que ele for necessário.
 *
 * Rodar:
 *   CLINICORP_USERNAME=... CLINICORP_TOKEN=... CLINICORP_SUBSCRIBER_ID=... \
 *   pnpm --filter @dentaltrack/api clinicorp:smoke
 *
 * Com o ciclo de escrita:
 *   CLINICORP_WRITE_TEST=1 pnpm --filter @dentaltrack/api clinicorp:smoke -- --write
 */

const TIMEZONE = process.env.CLINICORP_TIMEZONE ?? "America/Sao_Paulo";

/** Escrita: pedida no comando **e** autorizada no ambiente. */
const WRITE =
  process.argv.includes("--write") && process.env.CLINICORP_WRITE_TEST === "1";

/** Nome do paciente de teste — inconfundível para quem o vir na agenda. */
const TEST_PATIENT = "TESTE INTEGRACAO DENTALTRACK";
/** Distante o bastante para não colidir com nada real. */
const TEST_DAYS_AHEAD = 400;

interface StepResult {
  label: string;
  ok: boolean;
  detail: string;
  ms: number;
}

async function step(
  label: string,
  action: () => Promise<string>,
): Promise<StepResult> {
  const started = Date.now();
  try {
    const detail = await action();
    return { label, ok: true, detail, ms: Date.now() - started };
  } catch (err) {
    return {
      label,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  }
}

function print(result: StepResult): void {
  const mark = result.ok ? "OK  " : "FALHA";
  console.log(`${mark} ${result.label} (${result.ms}ms)`);
  console.log(`     ${result.detail}`);
}

async function main(): Promise<void> {
  const username = process.env.CLINICORP_USERNAME;
  const token = process.env.CLINICORP_TOKEN;

  if (!username || !token) {
    console.error(
      [
        "Faltam credenciais. Defina no ambiente (ou no apps/api/.env):",
        "  CLINICORP_USERNAME=usuário da API (não é o login do painel)",
        "  CLINICORP_TOKEN=token da API",
        "  CLINICORP_SUBSCRIBER_ID=id do assinante (o smoke descobre se faltar)",
        "",
        "Usuário e token ficam no painel do Clinicorp: Gerenciar Assinatura →",
        "Acesso Externo e Integrações → Integrações (Usuário API / Token API).",
      ].join("\n"),
    );
    process.exit(1);
  }

  const baseUrl = process.env.CLINICORP_BASE_URL ?? CLINICORP_DEFAULT_BASE_URL;
  console.log(`Clinicorp smoke · ${baseUrl} · fuso ${TIMEZONE}\n`);

  const client = new ClinicorpClient({
    username,
    token,
    subscriberId: process.env.CLINICORP_SUBSCRIBER_ID ?? null,
    baseUrl,
  });
  const provider = new ClinicorpAgendaProvider(client, TIMEZONE);

  const results: StepResult[] = [];
  let unitId: string | null = process.env.CLINICORP_UNIT_ID ?? null;

  // Primeiro passo de propósito: é a única rota que responde sem
  // `subscriber_id`, então ela diz qual é o valor certo antes de qualquer outra
  // chamada poder falhar por causa dele.
  const subscribers = await step(
    "Descobrir o assinante (subscriber_id)",
    async () => {
      const found = await provider.listSubscribers();
      const configured = process.env.CLINICORP_SUBSCRIBER_ID ?? null;
      if (!found.length) {
        // Conta única: a rota responde vazio e o id aceito é o usuário da API.
        return `conta única (a rota respondeu vazio) — usando subscriber_id=${client.subscriberId()}`;
      }
      const lines = found.map(
        (s) =>
          `subscriber_id=${s.id}${s.namespace ? ` (namespace ${s.namespace})` : ""}`,
      );
      if (!configured) {
        lines.push(
          "CLINICORP_SUBSCRIBER_ID não definido — use o valor acima nas próximas rotas.",
        );
      } else if (!found.some((s) => s.id === configured)) {
        lines.push(
          `CLINICORP_SUBSCRIBER_ID=${configured} não está entre os encontrados.`,
        );
      }
      return lines.join("\n     ");
    },
  );
  results.push(subscribers);
  print(subscribers);

  const units = await step("Listar unidades", async () => {
    const found = await provider.listUnits();
    unitId ??= found[0]?.id ?? null;
    return found.length
      ? found.map((u) => `${u.id}=${u.name}`).join(" · ")
      : "nenhuma unidade retornada (confira o subscriber_id descoberto acima)";
  });
  results.push(units);
  print(units);

  // Sem unidade, as consultas de agenda não têm como ser feitas — parar aqui
  // dá uma resposta clara em vez de três timeouts seguidos.
  if (!units.ok || !unitId) {
    console.log("\nParando: sem unidade não dá para consultar a agenda.");
    process.exit(1);
  }

  const professionals = await step("Listar profissionais", async () => {
    const found = await provider.listProfessionals(unitId);
    return found.length
      ? found.map((p) => `${p.id}=${p.name}`).join(" · ")
      : "nenhum profissional retornado";
  });
  results.push(professionals);
  print(professionals);

  const statuses = await step("Listar status de agendamento", async () => {
    const found = await provider.listStatuses();
    if (!found.length) return "nenhum status retornado";
    // A sugestão de mapeamento é a informação mais útil do smoke: mostra o que
    // o sistema reconhece sozinho e o que o operador vai precisar decidir.
    const suggested = suggestStatusMappings(found);
    return suggested
      .map((s) => `${s.externalId}=${s.externalName} → ${s.status ?? "(decidir)"}`)
      .join("\n     ");
  });
  results.push(statuses);
  print(statuses);

  const from = new Date();
  const to = new Date(from.getTime() + 7 * 24 * 3_600_000);

  const availability = await step("Consultar horários livres (7 dias)", async () => {
    // A rota exige profissional; sem CLINICORP_PROFESSIONAL_ID o adapter
    // consulta um a um e une os horários.
    const slots = await provider.listAvailableSlots({
      from,
      to,
      unitId,
      professionalId: process.env.CLINICORP_PROFESSIONAL_ID ?? null,
      limit: 5,
    });
    return slots.length
      ? slots.map((s) => s.startsAt).join(" · ")
      : "nenhum horário livre (a rota respondeu, mas a agenda está cheia)";
  });
  results.push(availability);
  print(availability);

  const agenda = await step("Ler a agenda (7 dias)", async () => {
    const appointments = await provider.listAppointments({ from, to, unitId });
    if (!appointments.length) return "nenhum agendamento na janela";
    const sample = appointments[0];
    return [
      `${appointments.length} agendamento(s). Primeiro:`,
      `id=${sample.externalId} paciente=${sample.patientName ?? "?"}`,
      `início=${sample.startsAt.toISOString()} status=${sample.statusName ?? "?"}`,
    ].join(" ");
  });
  results.push(agenda);
  print(agenda);

  let createdId: string | null = null;
  if (WRITE) {
    createdId = await writeCycle(provider, unitId, results);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");

  // O id sai impresso sempre: cancelar pela API é justamente o que ainda não
  // foi validado ao vivo, então quem roda precisa poder conferir na tela.
  if (createdId) {
    console.log(
      `Agendamento de teste criado: ${createdId}.`,
      "\nConfira na agenda do Clinicorp e remova-o se o cancelamento acima falhou.\n",
    );
  }

  if (failed.length === 0) {
    console.log(
      WRITE
        ? "Leitura e escrita responderam. A integração pode ir para o modo real."
        : [
            "Tudo respondeu na leitura. Para exercitar a escrita (cria e cancela um",
            "agendamento de teste em data distante):",
            "  CLINICORP_WRITE_TEST=1 pnpm --filter @dentaltrack/api clinicorp:smoke -- --write",
          ].join("\n"),
    );
    return;
  }

  console.log(
    `${failed.length} etapa(s) falharam. Cada divergência de campo se conserta em`,
    "\napps/api/src/clinicorp/clinicorp.provider.ts (leitura) ou clinicorp.client.ts (rotas).",
  );
  process.exit(1);
}

/**
 * Ciclo de escrita: criar paciente → criar agendamento → cancelar (P0.1).
 *
 * É o único jeito honesto de responder "a criação funciona?" antes de um
 * cliente depender dela. As três rotas são as que a F9 declarou e nunca foram
 * exercitadas contra a API real — inclusive `cancel_appointment`, que o P0.5
 * passou a chamar.
 *
 * Devolve o id criado (ou `null`), para o relatório poder pedir a remoção
 * manual se o cancelamento não funcionar.
 */
async function writeCycle(
  provider: ClinicorpAgendaProvider,
  unitId: string,
  results: StepResult[],
): Promise<string | null> {
  console.log("\n--- Ciclo de escrita (CLINICORP_WRITE_TEST=1) ---\n");

  // O Clinicorp recusa horário fora do expediente com "horário ocupado"
  // (visto ao vivo), então o teste pede à própria agenda um horário livre do
  // dia distante; só sem resposta cai na madrugada.
  const testDay = new Date(Date.now() + TEST_DAYS_AHEAD * 24 * 3_600_000);
  let startsAt = new Date(testDay);
  startsAt.setUTCHours(6, 0, 0, 0); // ~03:00 em São Paulo
  const professionalId = process.env.CLINICORP_PROFESSIONAL_ID ?? null;
  const slot = await step("Escolher um horário livre no dia de teste", async () => {
    const dayStart = new Date(testDay.getTime() - 24 * 3_600_000);
    const dayEnd = new Date(testDay.getTime() + 24 * 3_600_000);
    const free = await provider.listAvailableSlots({
      from: dayStart,
      to: dayEnd,
      unitId,
      professionalId,
      limit: 1,
    });
    if (!free.length) return `nenhum horário livre; usando ${startsAt.toISOString()}`;
    startsAt = new Date(free[0].startsAt);
    return `${free[0].startsAt} (profissional ${free[0].professionalId ?? "?"})`;
  });
  results.push(slot);
  print(slot);
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
  let externalId: string | null = null;

  const patient = await step("Criar o paciente de teste", async () => {
    const created = await provider.createPatient({
      name: TEST_PATIENT,
      phone: null,
    });
    return `id=${created.id}`;
  });
  results.push(patient);
  print(patient);
  if (!patient.ok) return null;

  const patientId = /id=(.+)/.exec(patient.detail)?.[1] ?? null;

  const created = await step("Criar o agendamento de teste", async () => {
    const appointment = await provider.createAppointment({
      patientId,
      patientName: TEST_PATIENT,
      patientPhone: null,
      startsAt,
      endsAt,
      unitId,
      professionalId: professionalId ?? "",
      procedureName: null,
      notes: "Criado pelo clinicorp:smoke do DentalTrack. Pode cancelar.",
    });
    externalId = appointment.externalId;
    return `id=${appointment.externalId} em ${startsAt.toISOString()}`;
  });
  results.push(created);
  print(created);
  if (!created.ok || !externalId) return null;

  const canceled = await step("Cancelar o agendamento de teste", async () => {
    await provider.cancelAppointment({ externalId: externalId as string, unitId });
    return "cancelado (confira na tela — esta rota nunca foi validada ao vivo)";
  });
  results.push(canceled);
  print(canceled);

  return externalId;
}

main().catch((err) => {
  console.error("Falha no clinicorp:smoke:", err);
  process.exit(1);
});
