import "dotenv/config";
import { googleAgendaConfigSchema } from "@dentaltrack/shared";
import { agendaErrorKind } from "../src/clinicorp/agenda-provider";
import { GoogleAgendaProvider } from "../src/google-agenda/google-agenda.provider";
import { GoogleCalendarClient } from "../src/google-agenda/google-calendar.client";

/**
 * Smoke do Google Agenda (P0.1) — **o ciclo real, com escrita**.
 *
 * O `clinicorp:smoke` é só-leitura de propósito: a credencial é do cliente e o
 * sistema é o prontuário dele. Aqui é diferente e o ciclo precisa fechar: cria
 * um evento de teste, confirma que ele aparece na leitura e **apaga**. Sem essa
 * volta completa, "a agenda está conectada" continua sendo uma afirmação sobre
 * leitura, e o caminho de escrita — o que marca consulta de verdade — só seria
 * exercitado pela primeira vez com um cliente real do outro lado.
 *
 * O evento nasce a mais de um ano no futuro e às 3h da manhã: se algo der
 * errado e ele sobreviver, não atrapalha nenhuma agenda de verdade, e o script
 * imprime o id para remoção manual.
 *
 * Rodar:
 *   GOOGLE_CALENDAR_SA_EMAIL=... GOOGLE_CALENDAR_SA_KEY=... GOOGLE_CALENDAR_ID=... \
 *   pnpm --filter @dentaltrack/api google:smoke
 *
 * `--somente-leitura` pula a parte de escrita.
 */

const TIMEZONE = process.env.GOOGLE_CALENDAR_TIMEZONE ?? "America/Sao_Paulo";
const READ_ONLY = process.argv.includes("--somente-leitura");

/** Marcação do evento de teste — reconhecível por qualquer um que o veja. */
const TEST_SUMMARY = "TESTE INTEGRACAO DENTALTRACK (pode apagar)";
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
    return { label, ok: true, detail: await action(), ms: Date.now() - started };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      label,
      ok: false,
      // A categoria é a informação acionável: "auth" manda conferir o
      // compartilhamento da agenda; "indisponivel" manda esperar.
      detail: `[${agendaErrorKind(err)}] ${detail}`,
      ms: Date.now() - started,
    };
  }
}

function print(result: StepResult): void {
  console.log(`${result.ok ? "OK  " : "FALHA"} ${result.label} (${result.ms}ms)`);
  console.log(`     ${result.detail}`);
}

async function main(): Promise<void> {
  const email = process.env.GOOGLE_CALENDAR_SA_EMAIL;
  const key = process.env.GOOGLE_CALENDAR_SA_KEY;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!email || !key || !calendarId) {
    console.error(
      [
        "Faltam variáveis. Defina no ambiente (ou no apps/api/.env):",
        "  GOOGLE_CALENDAR_SA_EMAIL=conta de serviço (agenda@projeto.iam.gserviceaccount.com)",
        "  GOOGLE_CALENDAR_SA_KEY=chave privada PEM da conta de serviço",
        "  GOOGLE_CALENDAR_ID=id da agenda a testar",
        "",
        "A agenda precisa estar compartilhada com a conta de serviço com",
        'permissão "Fazer alterações em eventos". Ver docs/operacao.md.',
      ].join("\n"),
    );
    process.exit(1);
  }

  const config = googleAgendaConfigSchema.parse({ calendarId });
  const client = new GoogleCalendarClient({
    serviceAccountEmail: email,
    privateKey: key,
  });
  const provider = new GoogleAgendaProvider(client, TIMEZONE, config);

  console.log(
    `Google Agenda smoke · ${calendarId} · fuso ${TIMEZONE}` +
      (READ_ONLY ? " · somente leitura\n" : " · com escrita de teste\n"),
  );

  const results: StepResult[] = [];
  const run = async (label: string, action: () => Promise<string>) => {
    const result = await step(label, action);
    results.push(result);
    print(result);
    return result.ok;
  };

  // A leitura dos metadados é o teste de compartilhamento: se a conta de
  // serviço não enxerga a agenda, nada depois disso vai funcionar.
  const shared = await run("Ler a agenda (valida o compartilhamento)", async () => {
    const [unit] = await provider.listUnits();
    return `"${unit?.name ?? "?"}" (${unit?.id ?? "?"})`;
  });
  if (!shared) {
    // A causa está na categoria entre colchetes acima; repeti-la aqui como
    // palpite ("não está compartilhada") mandaria o operador conferir a coisa
    // errada quando o problema é a chave do servidor.
    console.log(
      "\nParando: sem ler a agenda, nada depois disso funciona.",
      "\n  [auth]   → compartilhe a agenda com",
      email,
      'com permissão "Fazer alterações em eventos"',
      "\n  [config] → confira o GOOGLE_CALENDAR_ID e a chave da conta de serviço",
      "\n  outros   → é do lado do Google; tente de novo em alguns minutos",
    );
    process.exit(1);
  }

  const from = new Date();
  const to = new Date(from.getTime() + 7 * 24 * 3_600_000);

  await run("Consultar horários livres (7 dias)", async () => {
    const slots = await provider.listAvailableSlots({ from, to, limit: 5 });
    return slots.length
      ? slots.map((s) => s.startsAt).join(" · ")
      : "nenhum horário livre no expediente padrão (08:00–18:00, seg–sex)";
  });

  await run("Ler os eventos da semana", async () => {
    const appointments = await provider.listAppointments({ from, to });
    if (!appointments.length) return "nenhum evento na janela";
    const first = appointments[0];
    return `${appointments.length} evento(s). Primeiro: ${first.startsAt.toISOString()} — ${first.patientName ?? "?"}`;
  });

  if (READ_ONLY) {
    report(results);
    return;
  }

  // --- Ciclo de escrita: criar → confirmar → apagar ---------------------------

  const startsAt = new Date(from.getTime() + TEST_DAYS_AHEAD * 24 * 3_600_000);
  startsAt.setUTCHours(6, 0, 0, 0); // ~03:00 em São Paulo
  const endsAt = new Date(startsAt.getTime() + 30 * 60_000);

  let externalId: string | null = null;

  const created = await run("Criar um evento de teste", async () => {
    const appointment = await provider.createAppointment({
      patientId: null,
      patientName: TEST_SUMMARY,
      patientPhone: null,
      startsAt,
      endsAt,
      unitId: calendarId,
      professionalId: "google-agenda",
      procedureName: null,
      notes: "Evento criado pelo google:smoke do DentalTrack. Pode apagar.",
    });
    externalId = appointment.externalId;
    return `id=${appointment.externalId} em ${startsAt.toISOString()}`;
  });

  if (created && externalId) {
    await run("Confirmar que ele aparece na leitura", async () => {
      const janela = await provider.listAppointments({
        from: new Date(startsAt.getTime() - 3_600_000),
        to: new Date(endsAt.getTime() + 3_600_000),
      });
      const found = janela.find((a) => a.externalId === externalId);
      if (!found) {
        throw new Error(
          "o evento foi criado mas não voltou na leitura — a escrita e a leitura discordam",
        );
      }
      return `encontrado: ${found.patientName ?? "?"}`;
    });

    await run("Apagar o evento de teste", async () => {
      await provider.cancelAppointment({ externalId: externalId as string });
      const janela = await provider.listAppointments({
        from: new Date(startsAt.getTime() - 3_600_000),
        to: new Date(endsAt.getTime() + 3_600_000),
      });
      // O `listEvents` inclui cancelados (`showDeleted`), então o que se
      // confirma aqui é o status, não o desaparecimento da lista.
      const ainda = janela.find(
        (a) => a.externalId === externalId && a.statusExternalId !== "cancelled",
      );
      if (ainda) throw new Error("o evento continua ativo na agenda");
      return "removido";
    });
  }

  report(results, externalId);
}

function report(results: StepResult[], externalId?: string | null): void {
  const failed = results.filter((r) => !r.ok);
  console.log("");

  // O id vai impresso sempre que houve criação: se o apagar falhou, é por ele
  // que alguém remove o evento à mão.
  const apagou = results.find((r) => r.label.startsWith("Apagar"))?.ok;
  if (externalId && !apagou) {
    console.log(
      `ATENÇÃO: o evento de teste ${externalId} pode ter ficado na agenda. Remova-o à mão.\n`,
    );
  }

  if (failed.length === 0) {
    console.log(
      "Ciclo completo: a agenda foi lida, um evento foi criado, confirmado e apagado.",
      "\nO caminho de escrita funciona — pode ligar o modo real em Configurações → Integração.",
    );
    return;
  }

  console.log(
    `${failed.length} etapa(s) falharam. A categoria entre colchetes diz o que fazer:`,
    "\n  auth        → a agenda não está compartilhada com a conta de serviço (ou a chave está errada)",
    "\n  config      → o ID da agenda não existe para esta conta",
    "\n  indisponivel→ o Google está com problema; tente de novo",
    "\n  timeout     → instabilidade de rede",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("Falha no google:smoke:", err);
  process.exit(1);
});
