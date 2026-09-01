import "dotenv/config";
import {
  ClinicorpClient,
  CLINICORP_DEFAULT_BASE_URL,
} from "../src/clinicorp/clinicorp.client";
import { ClinicorpAgendaProvider } from "../src/clinicorp/clinicorp.provider";
import { suggestStatusMappings } from "../src/clinicorp/status-heuristics";

/**
 * Smoke do Clinicorp (F9) — **só leitura**, sem banco e sem a aplicação.
 *
 * É o primeiro comando a rodar no dia em que a credencial do cliente chegar.
 * Ele percorre a cadeia inteira que as automações dependem e imprime o que cada
 * rota respondeu, para que a verdade sobre a API apareça em cinco minutos em
 * vez de aparecer depurando em produção.
 *
 * Nada aqui escreve no sistema do cliente: nenhum paciente é criado, nenhum
 * agendamento é marcado. A criação fica atrás da tela, depois deste smoke passar.
 *
 * Rodar:
 *   CLINICORP_USERNAME=... CLINICORP_TOKEN=... CLINICORP_SUBSCRIBER_ID=... \
 *   pnpm --filter @dentaltrack/api clinicorp:smoke
 */

const TIMEZONE = process.env.CLINICORP_TIMEZONE ?? "America/Sao_Paulo";

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
        "  CLINICORP_SUBSCRIBER_ID=contexto da conta (opcional em algumas rotas)",
        "",
        "Quem pede essas três informações ao suporte do Clinicorp é o assinante",
        "— o dono da clínica. Ver docs/CLINICORP.md.",
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

  const units = await step("Listar unidades", async () => {
    const found = await provider.listUnits();
    unitId ??= found[0]?.id ?? null;
    return found.length
      ? found.map((u) => `${u.id}=${u.name}`).join(" · ")
      : "nenhuma unidade retornada (verifique o Subscriber ID)";
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
    const slots = await provider.listAvailableSlots({ from, to, unitId, limit: 5 });
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

  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(
      "Tudo respondeu. Próximo passo: ligar o modo real em Configurações → Integração,",
      "\nconferir o mapeamento de status e só então habilitar a criação de agendamentos.",
    );
    return;
  }

  console.log(
    `${failed.length} etapa(s) falharam. Cada divergência de campo se conserta em`,
    "\napps/api/src/clinicorp/clinicorp.provider.ts (leitura) ou clinicorp.client.ts (rotas).",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("Falha no clinicorp:smoke:", err);
  process.exit(1);
});
