import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { FUNNEL_STAGES, FUNNEL_STAGE_DEFAULT_NAMES, type FunnelStage } from "@dentaltrack/shared";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Seed de **demonstração** (F3) — popula a clínica demo com ~50 dias de
 * conversas sintéticas (mensagens, leads, agendamentos e tags) para o
 * dashboard/leads renderizarem com volume realista. SEPARADO do catálogo
 * (`db:seed`), que deve rodar antes (tags/procedimentos/settings).
 *
 * Desde a P1.2 cobre também o que as telas de operação mostram: agendamentos
 * com horário real nos seis status, a fila de saída nos quatro status (aba
 * Automações e mensagens programadas), descadastros, conversas em atendimento
 * humano e — só se `DEMO_USER_ID` vier por env — a membership que torna a
 * clínica visível para um usuário real (inventar um UUID geraria membership
 * órfã).
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
    reply:
      "Claro! O implante repõe o dente perdido com um pino de titânio e coroa. Posso te explicar e já agendar uma avaliação. Como é seu nome?",
  },
  {
    procedureId: "00000000-0000-0000-0000-00000000d002",
    tagId: "00000000-0000-0000-0000-00000000e002",
    procedure: "Clareamento dental",
    userText: "Meus dentes estão amarelados, queria fazer um clareamento.",
    reply:
      "Temos clareamento estético que deixa o sorriso bem mais branco. Posso te passar os detalhes e agendar uma avaliação. Qual seu nome?",
  },
  {
    procedureId: "00000000-0000-0000-0000-00000000d003",
    tagId: "00000000-0000-0000-0000-00000000e003",
    procedure: "Ortodontia (aparelho)",
    userText: "Quero alinhar meus dentes com aparelho.",
    reply:
      "Ótimo! Trabalhamos com aparelho fixo e alinhadores. Uma avaliação define a melhor opção pra você. Como você se chama?",
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
    reply:
      "Sinto muito! Atendemos urgências. Vou priorizar seu atendimento — me diga seu nome e telefone para encaixar o quanto antes.",
  },
];

const NAMES = [
  "Ana Souza",
  "Bruno Lima",
  "Carla Mendes",
  "Diego Alves",
  "Eduarda Rocha",
  "Felipe Castro",
  "Gabriela Dias",
  "Henrique Pinto",
  "Isabela Nunes",
  "João Ribeiro",
  "Karina Melo",
  "Lucas Faria",
  "Mariana Costa",
  "Nathan Gomes",
  "Olívia Barros",
  "Paulo Tavares",
  "Renata Lopes",
  "Sérgio Moraes",
  "Tatiane Cruz",
  "Vinícius Araújo",
];
/**
 * DDD 00 de propósito, como no `MockAgendaProvider`: a demo agora enfileira
 * mensagens de saída, e um ambiente apontando para um WhatsApp real não pode
 * mandar lembrete de mentira para o número de alguém. Com DDD inválido a
 * mensagem falha no transporte, que é o pior resultado aceitável.
 */
const DEMO_DDD = "00";

const rint = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[rint(0, arr.length - 1)];
/** Número inválido e estável quando recebe uma sequência — evita colisão nas fixtures obrigatórias. */
const phone = (sequence = rint(0, 8_999_999)) => {
  const subscriber = String(10_000_000 + sequence).slice(-8);
  return `(${DEMO_DDD}) 9${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
};
/** Mesma normalização do `OptOutService`/fila: só dígitos, com DDI. */
const normalizePhone = (value: string) => `55${value.replace(/\D/g, "")}`;

const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

type SeedAppointmentStatus = "pedido" | "agendado" | "confirmado" | "compareceu" | "faltou" | "cancelado";

interface DemoFixture {
  conversationStatus: "agendada" | "em_andamento";
  channel: "web" | "whatsapp";
  startsHoursAgo?: number;
  appointment?: { status: SeedAppointmentStatus; daysFromNow: number };
}

const appointmentFixture = (
  status: SeedAppointmentStatus,
  daysFromNow: number,
  channel: DemoFixture["channel"],
): DemoFixture => ({
  conversationStatus: "agendada",
  channel,
  appointment: { status, daysFromNow },
});

/**
 * Baseline obrigatório da P1.2. O restante do volume continua aleatório, mas
 * nenhuma execução pode perder um estado da agenda/fila nem os dois handoffs.
 */
const DEMO_BASELINE: DemoFixture[] = [
  {
    conversationStatus: "em_andamento",
    channel: "whatsapp",
    startsHoursAgo: 2,
  },
  {
    conversationStatus: "em_andamento",
    channel: "whatsapp",
    startsHoursAgo: 4,
  },
  appointmentFixture("compareceu", -16, "web"),
  appointmentFixture("compareceu", -15, "whatsapp"),
  appointmentFixture("compareceu", -14, "web"),
  appointmentFixture("compareceu", -13, "whatsapp"),
  appointmentFixture("compareceu", -12, "web"),
  appointmentFixture("compareceu", -11, "whatsapp"),
  appointmentFixture("compareceu", -10, "web"),
  appointmentFixture("compareceu", -9, "whatsapp"),
  appointmentFixture("faltou", -8, "whatsapp"),
  appointmentFixture("faltou", -7, "whatsapp"),
  appointmentFixture("cancelado", -6, "web"),
  appointmentFixture("agendado", 1, "whatsapp"),
  appointmentFixture("agendado", 2, "web"),
  appointmentFixture("confirmado", 3, "whatsapp"),
  appointmentFixture("confirmado", 4, "web"),
  appointmentFixture("pedido", 5, "web"),
];

interface Msg {
  role: "user" | "assistant";
  content: string;
  at: Date;
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "",
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const clinic = await prisma.clinic.findUnique({
      where: { id: DEMO_CLINIC_ID },
    });
    if (!clinic) {
      throw new Error("Clínica demo não encontrada — rode `db:seed` (catálogo) antes do demo.");
    }

    // Limpa dados de conversa anteriores (mantém catálogo/tags/settings).
    // Cards do funil primeiro (FK RESTRICT p/ coluna); colunas personalizadas
    // depois. As 5 do sistema são reaproveitadas (upsert por systemStage).
    await prisma.outboundMessage.deleteMany({
      where: { clinicId: DEMO_CLINIC_ID },
    });
    await prisma.contactOptOut.deleteMany({
      where: { clinicId: DEMO_CLINIC_ID },
    });
    await prisma.pipelineCard.deleteMany({
      where: { clinicId: DEMO_CLINIC_ID },
    });
    await prisma.pipelineStage.deleteMany({
      where: { clinicId: DEMO_CLINIC_ID, systemStage: null },
    });
    await prisma.conversationTag.deleteMany({
      where: { clinicId: DEMO_CLINIC_ID },
    });
    await prisma.appointment.deleteMany({
      where: { clinicId: DEMO_CLINIC_ID },
    });
    await prisma.message.deleteMany({ where: { clinicId: DEMO_CLINIC_ID } });
    await prisma.conversation.deleteMany({
      where: { clinicId: DEMO_CLINIC_ID },
    });
    await prisma.lead.deleteMany({ where: { clinicId: DEMO_CLINIC_ID } });

    const TOTAL = 90;
    let scheduled = 0;
    let engaged = 0;
    let abandoned = 0;
    let returns = 0;
    let handoffs = 0;
    // Agendamentos criados — alimentam a fila de saída depois do loop.
    const appointments: SeedAppointment[] = [];
    // Leads que já agendaram — candidatos a voltar para agendar de novo
    // (alimenta a seção "Abandono × Recorrência" do dashboard).
    const scheduledLeadIds: string[] = [];
    // Dados por conversa para povoar o funil (F7) depois do loop.
    const convoRows: {
      conversationId: string;
      leadId: string;
      status: string;
      engaged: boolean;
      lastAt: Date;
    }[] = [];

    for (let i = 0; i < TOTAL; i++) {
      const fixture: DemoFixture | undefined = DEMO_BASELINE[i];
      const r = Math.random();
      // O baseline já traz 16 agendamentos; ~21% das 72 restantes mantém o
      // volume total perto dos 31 registros validados na primeira rodada.
      const status: "agendada" | "em_andamento" | "abandonada" = fixture
        ? fixture.conversationStatus
        : r < 0.21
          ? "agendada"
          : r < 0.69
            ? "em_andamento"
            : "abandonada";
      // "em andamento" ficam nas últimas ~18h (sobrevivem ao cron de abandono de
      // 24h); agendadas/abandonadas (terminais) se espalham por ~50 dias.
      let start: Date;
      if (fixture?.startsHoursAgo !== undefined) {
        start = new Date(Date.now() - fixture.startsHoursAgo * HOUR_MS);
      } else if (fixture?.appointment) {
        const daysAgo = fixture.appointment.daysFromNow < 0 ? -fixture.appointment.daysFromNow + 5 : 3;
        start = dateAtDayOffset(-daysAgo, 10);
      } else if (status === "em_andamento") {
        start = new Date(Date.now() - rint(1, 18) * HOUR_MS - rint(0, 59) * MIN_MS);
      } else {
        const day = new Date();
        day.setHours(0, 0, 0, 0);
        day.setDate(day.getDate() - rint(1, 49));
        start = new Date(day.getTime() + rint(9, 18) * HOUR_MS + rint(0, 59) * MIN_MS);
      }
      const scenario = pick(SCENARIOS);

      // ~1/3 dos agendamentos vem de um paciente que já agendou antes
      // (recorrente): reusa o lead em vez de criar um novo.
      const returning =
        fixture === undefined && status === "agendada" && scheduledLeadIds.length > 0 && Math.random() < 0.35;
      // ~40% das conversas chegam pelo WhatsApp — é o canal que as telas de
      // operação (handoff, opt-out, fila) precisam mostrar.
      const channel = fixture?.channel ?? (Math.random() < 0.4 ? "whatsapp" : "web");
      const lead = returning
        ? await prisma.lead.findUniqueOrThrow({
            where: { id: pick(scheduledLeadIds) },
            select: { id: true, phone: true },
          })
        : await prisma.lead.create({
            data: {
              clinicId: DEMO_CLINIC_ID,
              name: pick(NAMES),
              phone: phone(i),
              source: channel,
              createdAt: start,
            },
            select: { id: true, phone: true },
          });

      // Roteiro de mensagens (abandonada = paciente não responde de volta).
      const msgs: Msg[] = [];
      let t = start.getTime();
      msgs.push({ role: "user", content: scenario.userText, at: new Date(t) });
      t += rint(1, 3) * MIN_MS;
      msgs.push({
        role: "assistant",
        content: scenario.reply,
        at: new Date(t),
      });

      const engages = status !== "abandonada";
      if (engages) {
        t += rint(2, 6) * MIN_MS;
        msgs.push({
          role: "user",
          content: "Perfeito! E como faço para agendar?",
          at: new Date(t),
        });
        t += rint(1, 3) * MIN_MS;
        msgs.push({
          role: "assistant",
          content: "Posso agendar sua avaliação. Qual o melhor dia e horário para você?",
          at: new Date(t),
        });
        if (status === "agendada") {
          t += rint(2, 5) * MIN_MS;
          msgs.push({
            role: "user",
            content: "Pode ser na próxima terça de manhã.",
            at: new Date(t),
          });
          t += rint(1, 2) * MIN_MS;
          msgs.push({
            role: "assistant",
            content: "Agendado! Sua avaliação está marcada. Qualquer dúvida, é só chamar. Até lá!",
            at: new Date(t),
          });
        }
      }

      const lastAt = msgs[msgs.length - 1].at;
      // Duas conversas do WhatsApp em andamento ficam com um atendente (P0.2):
      // é o que mostra o badge, o botão "Devolver para IA" e a caixa de resposta.
      const handoff = channel === "whatsapp" && status === "em_andamento" && handoffs < 2;
      if (handoff) handoffs += 1;
      const convo = await prisma.conversation.create({
        data: {
          clinicId: DEMO_CLINIC_ID,
          leadId: lead.id,
          channel,
          contactPhone: channel === "whatsapp" ? normalizePhone(lead.phone!) : null,
          status,
          createdAt: start,
          lastMessageAt: lastAt,
          ...(handoff
            ? {
                handoffAt: lastAt,
                handoffReason: pick(HANDOFF_REASONS),
              }
            : {}),
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
        // Horário real (F9): passado → compareceu/faltou/cancelado; futuro →
        // agendado/confirmado/pedido. É o que dá conteúdo à /agenda e às
        // automações (lembretes, remarcação após falta, retorno).
        const startsAt = fixture?.appointment
          ? dateAtDayOffset(fixture.appointment.daysFromNow, 9 + (i % 8))
          : appointmentSlot(start);
        const appointment = await prisma.appointment.create({
          data: {
            clinicId: DEMO_CLINIC_ID,
            conversationId: convo.id,
            leadId: lead.id,
            procedureId: scenario.procedureId,
            preferredTime: "Próxima terça de manhã",
            startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * MIN_MS),
            status: fixture?.appointment?.status ?? appointmentStatus(startsAt),
            source: "bot",
            createdAt: lastAt,
          },
          select: { id: true, status: true, startsAt: true },
        });
        appointments.push({
          id: appointment.id,
          status: appointment.status,
          startsAt: appointment.startsAt!,
          leadId: lead.id,
          conversationId: convo.id,
          phone: normalizePhone(lead.phone!),
        });
        scheduled += 1;
        if (returning) returns += 1;
        else scheduledLeadIds.push(lead.id);
      }
      if (engages) engaged += 1;
      if (status === "abandonada") abandoned += 1;

      convoRows.push({
        conversationId: convo.id,
        leadId: lead.id,
        status,
        engaged: engages,
        lastAt,
      });
    }

    const pipeline = await seedPipeline(prisma, convoRows);
    const optOuts = await seedOptOuts(prisma, appointments);
    const outbound = await seedOutbound(prisma, appointments, optOuts);
    assertDemoCoverage(appointments, outbound, optOuts.length, handoffs);
    const membership = await seedMembership(prisma);

    const byStatus = appointments.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `✔ Demo populada: ${TOTAL} conversas (engajadas≈${engaged}, agendadas=${scheduled}, recorrentes=${returns}, abandonadas=${abandoned}, em atendimento humano=${handoffs}) ao longo de ~50 dias.`,
    );
    console.log(
      `✔ Agenda: ${appointments.length} agendamentos com horário real (${Object.entries(byStatus)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}).`,
    );
    console.log(
      `✔ Fila de saída: ${outbound.pendente} pendentes, ${outbound.enviado} enviadas, ${outbound.falhou} falhas, ${outbound.suprimido} suprimidas · ${optOuts.length} descadastros.`,
    );
    console.log(
      `✔ Funil populado: ${pipeline.cards} cards em ${pipeline.stages} colunas (${pipeline.manual} clientes manuais).`,
    );
    console.log(
      membership
        ? `✔ Membership: usuário ${membership} é owner da clínica demo.`
        : "ℹ Sem DEMO_USER_ID no env — nenhuma membership criada; a clínica demo só aparece para quem tiver uma.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

/** Motivos plausíveis para um atendente assumir a conversa. */
const HANDOFF_REASONS = [
  "Cliente pediu para falar com uma pessoa.",
  "Negociação de orçamento — fora da alçada do assistente.",
];

interface SeedAppointment {
  id: string;
  status: SeedAppointmentStatus;
  startsAt: Date;
  leadId: string;
  conversationId: string;
  /** Telefone normalizado do lead (o que a fila usa). */
  phone: string;
}

/** Data relativa ao dia da execução; não cria fixtures que expiram com o calendário. */
function dateAtDayOffset(daysFromNow: number, hour: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function assertDemoCoverage(
  appointments: SeedAppointment[],
  outbound: Record<"pendente" | "enviado" | "falhou" | "suprimido", number>,
  optOuts: number,
  handoffs: number,
): void {
  const requiredStatuses: SeedAppointmentStatus[] = [
    "pedido",
    "agendado",
    "confirmado",
    "compareceu",
    "faltou",
    "cancelado",
  ];
  const present = new Set(appointments.map((appointment) => appointment.status));
  const missingAppointments = requiredStatuses.filter((status) => !present.has(status));
  const missingOutbound = Object.entries(outbound)
    .filter(([, count]) => count === 0)
    .map(([status]) => status);
  const outboundMatchesBaseline =
    outbound.pendente === 4 &&
    outbound.enviado === 8 &&
    outbound.falhou === 2 &&
    outbound.suprimido === 2;
  if (
    missingAppointments.length ||
    missingOutbound.length ||
    !outboundMatchesBaseline ||
    optOuts !== 2 ||
    handoffs !== 2
  ) {
    throw new Error(
      `Demo incompleta: agenda=[${missingAppointments.join(", ") || "ok"}], fila=${JSON.stringify(outbound)}, opt-outs=${optOuts}, handoffs=${handoffs}.`,
    );
  }
}

/**
 * Horário da consulta, em hora comercial e minuto cheio ou meia. Um terço
 * cai nos próximos 10 dias (é o que dá conteúdo à semana da /agenda e aos
 * lembretes pendentes); o resto fica entre 1 e 12 dias depois do início da
 * conversa — e como as conversas se espalham por ~50 dias para trás, isso
 * vira o histórico de compareceu/faltou/cancelado.
 */
function appointmentSlot(conversationStart: Date): Date {
  const d = Math.random() < 0.34 ? new Date() : new Date(conversationStart);
  d.setDate(d.getDate() + rint(1, 12));
  d.setHours(rint(9, 17), pick([0, 30]), 0, 0);
  return d;
}

/** Passado: compareceu (maioria), faltou ou cancelado. Futuro: agendado/confirmado/pedido. */
function appointmentStatus(startsAt: Date): SeedAppointment["status"] {
  const r = Math.random();
  if (startsAt.getTime() < Date.now()) {
    return r < 0.6 ? "compareceu" : r < 0.85 ? "faltou" : "cancelado";
  }
  return r < 0.55 ? "agendado" : r < 0.9 ? "confirmado" : "pedido";
}

/**
 * Dois descadastros (F9/P1.5): um por palavra-chave no WhatsApp e um pedido
 * à recepção. Telefones de leads reais da demo, para o painel do lead mostrar
 * "descadastrado" e a fila mostrar a supressão correspondente.
 */
async function seedOptOuts(prisma: PrismaClient, appointments: SeedAppointment[]): Promise<SeedAppointment[]> {
  // Um lead recorrente pode ter duas faltas: escolhe uma por telefone, senão
  // o mesmo descadastro (e a mesma supressão) seria gravado duas vezes.
  const byPhone = new Map<string, SeedAppointment>();
  for (const a of appointments) {
    if (a.status === "faltou" && !byPhone.has(a.phone)) byPhone.set(a.phone, a);
  }
  const candidates = [...byPhone.values()].slice(0, 2);
  const reasons = ["PARAR", "pedido à recepção"];
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    await prisma.contactOptOut.upsert({
      where: { clinicId_phone: { clinicId: DEMO_CLINIC_ID, phone: a.phone } },
      update: { reason: reasons[i] },
      create: { clinicId: DEMO_CLINIC_ID, phone: a.phone, reason: reasons[i] },
    });
  }
  return candidates;
}

/**
 * Fila de saída nos quatro status que a aba Automações e o painel de
 * mensagens programadas mostram. As chaves seguem `automation-keys.ts`
 * (tipo:agendamento:minutos) para o planejador real reconhecer as linhas e
 * não enfileirar de novo o que a demo já cobriu.
 */
async function seedOutbound(
  prisma: PrismaClient,
  appointments: SeedAppointment[],
  optOuts: SeedAppointment[],
): Promise<Record<"pendente" | "enviado" | "falhou" | "suprimido", number>> {
  const stamp = (d: Date) => String(Math.floor(d.getTime() / 60_000));
  const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const counts = { pendente: 0, enviado: 0, falhou: 0, suprimido: 0 };
  const lead = async (id: string) =>
    (await prisma.lead.findUnique({ where: { id }, select: { name: true } }))?.name ?? "cliente";

  const future = appointments
    .filter((a) => a.startsAt.getTime() > Date.now() && a.status !== "pedido")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = appointments.filter((a) => a.startsAt.getTime() <= Date.now());

  // Pendentes: lembrete de 1 dia para as próximas consultas, previsto para
  // sair na véspera às 10h (ou daqui a 1h, se a véspera já passou).
  for (const a of future.slice(0, 4)) {
    const eve = new Date(a.startsAt.getTime() - 24 * HOUR_MS);
    eve.setHours(10, 0, 0, 0);
    const scheduledFor = eve.getTime() > Date.now() ? eve : new Date(Date.now() + HOUR_MS);
    await prisma.outboundMessage.create({
      data: {
        clinicId: DEMO_CLINIC_ID,
        kind: "lembrete_1d",
        status: "pendente",
        dedupeKey: `lembrete_1d:${a.id}:${stamp(a.startsAt)}`,
        scheduledFor,
        body: `Olá, ${await lead(a.leadId)}! Seu horário é amanhã às ${hhmm(a.startsAt)}. Posso confirmar sua presença?`,
        phone: a.phone,
        leadId: a.leadId,
        conversationId: a.conversationId,
        appointmentId: a.id,
      },
    });
    counts.pendente += 1;
  }

  // Enviadas: lembrete de 3 dias das consultas que já aconteceram.
  for (const a of past.filter((x) => x.status === "compareceu").slice(0, 8)) {
    const sentAt = new Date(a.startsAt.getTime() - 3 * 24 * HOUR_MS);
    await prisma.outboundMessage.create({
      data: {
        clinicId: DEMO_CLINIC_ID,
        kind: "lembrete_3d",
        status: "enviado",
        dedupeKey: `lembrete_3d:${a.id}:${stamp(a.startsAt)}`,
        scheduledFor: sentAt,
        sentAt,
        body: `Olá, ${await lead(a.leadId)}! Passando para lembrar do seu horário no dia ${a.startsAt.toLocaleDateString("pt-BR")}. Está tudo certo para você?`,
        phone: a.phone,
        leadId: a.leadId,
        conversationId: a.conversationId,
        appointmentId: a.id,
        createdAt: sentAt,
      },
    });
    counts.enviado += 1;
  }

  // Falhas: o lembrete de 1 hora que o transporte recusou (número inválido).
  for (const a of past.filter((x) => x.status === "faltou").slice(0, 2)) {
    const at = new Date(a.startsAt.getTime() - HOUR_MS);
    await prisma.outboundMessage.create({
      data: {
        clinicId: DEMO_CLINIC_ID,
        kind: "lembrete_1h",
        status: "falhou",
        dedupeKey: `lembrete_1h:${a.id}:${stamp(a.startsAt)}`,
        scheduledFor: at,
        retries: 2,
        error: "Evolution respondeu 400: número não existe no WhatsApp",
        body: `Olá, ${await lead(a.leadId)}! Seu horário é hoje às ${hhmm(a.startsAt)}. Estamos te esperando!`,
        phone: a.phone,
        leadId: a.leadId,
        conversationId: a.conversationId,
        appointmentId: a.id,
        createdAt: at,
      },
    });
    counts.falhou += 1;
  }

  // Suprimidas: a remarcação após falta de quem pediu para não receber mais.
  for (const a of optOuts) {
    const at = new Date(a.startsAt.getTime() + 2 * HOUR_MS);
    await prisma.outboundMessage.create({
      data: {
        clinicId: DEMO_CLINIC_ID,
        kind: "falta",
        status: "suprimido",
        reason: "opt_out",
        dedupeKey: `falta:${a.id}:1`,
        scheduledFor: at,
        body: `Olá, ${await lead(a.leadId)}! Sentimos sua falta hoje. Quer que eu procure um novo horário para você?`,
        phone: a.phone,
        leadId: a.leadId,
        conversationId: a.conversationId,
        appointmentId: a.id,
        createdAt: at,
      },
    });
    counts.suprimido += 1;
  }

  return counts;
}

/**
 * Torna a clínica demo visível para um usuário real — só com `DEMO_USER_ID`
 * (o `sub` do JWT do Supabase). Sem ele, nada: uma membership com UUID
 * inventado seria lixo no banco que nenhum login alcança.
 */
async function seedMembership(prisma: PrismaClient): Promise<string | null> {
  const userId = process.env.DEMO_USER_ID?.trim();
  if (!userId) return null;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error(`DEMO_USER_ID inválido (esperado UUID): ${userId}`);
  }
  await prisma.membership.upsert({
    where: { userId_clinicId: { userId, clinicId: DEMO_CLINIC_ID } },
    update: { role: "owner" },
    create: { userId, clinicId: DEMO_CLINIC_ID, role: "owner" },
  });
  return userId;
}

/** Clientes manuais de exemplo (chegaram fora do chatbot) para o board. */
const MANUAL_CLIENTS: { name: string; stage: FunnelStage; note: string }[] = [
  {
    name: "Roberta Amaral",
    stage: "novo_contato",
    note: "Indicação da Dra. Helena — quer avaliar clareamento.",
  },
  {
    name: "Marcos Vinícius",
    stage: "quero_agendar",
    note: "Ligou no balcão pedindo orçamento de implante.",
  },
  {
    name: "Sandra Yamada",
    stage: "escolha_data",
    note: "Pediu horário na parte da manhã, aguardando retorno.",
  },
];

/**
 * Povoa o Funil de atendimento (F7): garante as 5 colunas do sistema + uma
 * coluna personalizada de exemplo, distribui um card por conversa na coluna
 * coerente com o progresso dela e adiciona alguns clientes manuais. Idempotente
 * junto do seed demo (os cards/colunas personalizadas foram limpos no início).
 */
async function seedPipeline(
  prisma: PrismaClient,
  convos: {
    conversationId: string;
    leadId: string;
    status: string;
    engaged: boolean;
    lastAt: Date;
  }[],
): Promise<{ stages: number; cards: number; manual: number }> {
  // 1. Colunas do sistema (upsert por systemStage) na ordem do funil.
  const stageIdBySystem = new Map<FunnelStage, string>();
  for (let i = 0; i < FUNNEL_STAGES.length; i++) {
    const systemStage = FUNNEL_STAGES[i];
    const stage = await prisma.pipelineStage.upsert({
      where: {
        clinicId_systemStage: { clinicId: DEMO_CLINIC_ID, systemStage },
      },
      update: {},
      create: {
        clinicId: DEMO_CLINIC_ID,
        name: FUNNEL_STAGE_DEFAULT_NAMES[systemStage],
        position: i,
        systemStage,
      },
      select: { id: true },
    });
    stageIdBySystem.set(systemStage, stage.id);
  }

  // 2. Coluna personalizada de exemplo (demonstra o CRUD de colunas).
  const custom = await prisma.pipelineStage.create({
    data: {
      clinicId: DEMO_CLINIC_ID,
      name: "Pós-atendimento",
      position: FUNNEL_STAGES.length,
    },
    select: { id: true },
  });

  // 3. Um card por conversa, na coluna coerente com o progresso.
  //    agendada → agendado · em andamento engajada → quero_agendar/escolha_data
  //    · em andamento sem engajar → interessado · abandonada → início do funil.
  const cardStage = (c: { status: string; engaged: boolean }): FunnelStage => {
    if (c.status === "agendada") return "agendado";
    if (c.status === "abandonada") return pick(["novo_contato", "interessado"]);
    return c.engaged ? pick(["quero_agendar", "escolha_data"]) : "interessado";
  };

  for (const c of convos) {
    await prisma.pipelineCard.create({
      data: {
        clinicId: DEMO_CLINIC_ID,
        conversationId: c.conversationId,
        leadId: c.leadId,
        stageId: stageIdBySystem.get(cardStage(c))!,
        source: "auto",
        stageSource: "auto",
        stageUpdatedAt: c.lastAt,
        createdAt: c.lastAt,
      },
    });
  }

  // 4. Clientes manuais (criam Lead source=manual + card manual). O último vai
  //    para a coluna personalizada, mostrando cards fora do fluxo automático.
  for (let i = 0; i < MANUAL_CLIENTS.length; i++) {
    const m = MANUAL_CLIENTS[i];
    const lead = await prisma.lead.create({
      data: {
        clinicId: DEMO_CLINIC_ID,
        name: m.name,
        phone: phone(),
        source: "manual",
      },
      select: { id: true },
    });
    const stageId = i === MANUAL_CLIENTS.length - 1 ? custom.id : stageIdBySystem.get(m.stage)!;
    await prisma.pipelineCard.create({
      data: {
        clinicId: DEMO_CLINIC_ID,
        leadId: lead.id,
        stageId,
        source: "manual",
        stageSource: "manual",
        note: m.note,
      },
    });
  }

  return {
    stages: FUNNEL_STAGES.length + 1,
    cards: convos.length + MANUAL_CLIENTS.length,
    manual: MANUAL_CLIENTS.length,
  };
}

main().catch((err: unknown) => {
  const meta = (err as { meta?: unknown })?.meta;
  console.error("Falha no seed demo:", err, meta ? JSON.stringify(meta) : "");
  process.exit(1);
});
