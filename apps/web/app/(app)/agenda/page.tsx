"use client";

import { useMemo, useState } from "react";
import {
  APPOINTMENT_STATUS_LABELS,
  AUTOMATION_LABELS,
  type AppointmentStatus,
  type OutboundMessageSummary,
} from "@dentaltrack/shared";
import {
  CalendarClock,
  CircleSlash,
  Link2,
  PlugZap,
  RefreshCw,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shell/page-header";
import { useAgenda, useSyncAgenda } from "@/hooks/use-agenda";
import { useAutomationHistory } from "@/hooks/use-automations";
import { useIntegration } from "@/hooks/use-integration";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS = [
  { value: "7", label: "7 dias" },
  { value: "15", label: "15 dias" },
  { value: "30", label: "30 dias" },
] as const;

/**
 * /agenda (F9) — o que está marcado e o que o sistema mandou.
 *
 * A tela existe para responder às duas perguntas que o dono faz quando liga as
 * automações: "a agenda chegou aqui certinho?" e "o lembrete saiu?". Por isso
 * ela mostra também **o que foi suprimido e por quê** — suprimido por
 * descadastro é o sistema acertando; falha de envio é problema a investigar.
 *
 * Fora do handoff de design; segue o design system existente (plan.md §6).
 */
export default function AgendaPage() {
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]["value"]>("7");
  const { from, to } = useMemo(() => datesFor(Number(range)), [range]);

  const { data, isLoading } = useAgenda(from, to);
  // O que interessa aqui é a integração **ativa**, seja ela qual for.
  const { data: clinicorpIntegration } = useIntegration("clinicorp");
  const { data: googleIntegration } = useIntegration(
    "google",
    clinicorpIntegration?.activeProvider === "google",
  );
  const integration =
    clinicorpIntegration?.activeProvider === "google"
      ? googleIntegration
      : clinicorpIntegration;
  const { data: history = [] } = useAutomationHistory(20);
  const sync = useSyncAgenda();

  const appointments = data?.appointments ?? [];

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle="Os horários marcados e as mensagens que o assistente enviou sozinho."
      >
        <Segmented
          aria-label="Período da agenda"
          options={RANGE_OPTIONS}
          value={range}
          onChange={setRange}
        />
        {integration && integration.mode !== "desligado" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} />
            {sync.isPending ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        )}
      </PageHeader>

      <IntegrationStrip
        mode={integration?.mode ?? "desligado"}
        lastSyncedAt={data?.lastSyncedAt ?? null}
      />

      <Card className="mb-5 gap-0 p-0">
        <div className="border-b border-border px-6 py-[18px]">
          <div className="text-base font-semibold tracking-[-0.01em]">
            Próximos atendimentos
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {appointments.length} agendamento(s) no período.
          </div>
        </div>

        {isLoading ? (
          <div className="p-6">
            <Skeleton className="h-40 w-full rounded-[var(--radius-sm)]" />
          </div>
        ) : appointments.length === 0 ? (
          <Empty
            icon={<CalendarClock className="size-5" />}
            title="Nenhum horário no período"
            desc="Marcações feitas pelo assistente aparecem aqui. Com o sistema de gestão conectado, a agenda inteira da empresa também."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Procedimento</TableHead>
                  <TableHead>Profissional</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appointments.map((appointment) => (
                  <TableRow key={appointment.id}>
                    <TableCell className="tabular whitespace-nowrap">
                      {appointment.startsAt
                        ? formatWhen(appointment.startsAt)
                        : (appointment.preferredTime ?? "—")}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {appointment.leadName ?? "Sem nome"}
                      </div>
                      {appointment.leadPhone && (
                        <div className="tabular text-xs text-muted-foreground">
                          {appointment.leadPhone}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{appointment.procedureName ?? "—"}</TableCell>
                    <TableCell>{appointment.professionalName ?? "—"}</TableCell>
                    <TableCell>
                      <AppointmentBadge status={appointment.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {appointment.source === "integracao"
                        ? "Sistema de gestão"
                        : appointment.source === "bot"
                          ? "Assistente"
                          : "Manual"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <HistoryCard history={history} />
    </>
  );
}

function IntegrationStrip({
  mode,
  lastSyncedAt,
}: {
  mode: string;
  lastSyncedAt: string | null;
}) {
  const connected = mode !== "desligado";
  return (
    <div
      className={cn(
        "mb-5 flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-border px-4 py-3 text-[13px]",
        connected ? "bg-primary-tint" : "bg-secondary",
      )}
    >
      {connected ? (
        <Link2 className="size-4 flex-none" style={{ color: "var(--primary)" }} />
      ) : (
        <PlugZap className="size-4 flex-none text-muted-foreground" />
      )}
      <span className={connected ? "text-primary" : "text-secondary-foreground"}>
        {mode === "live"
          ? "Conectado ao sistema de gestão — o assistente oferece só horários livres de verdade."
          : mode === "mock"
            ? "Integração em modo simulado — os dados abaixo são fictícios, para conhecer o fluxo."
            : "Sem sistema de gestão conectado. O assistente coleta a preferência e a equipe confirma."}
      </span>
      {lastSyncedAt && (
        <span className="ml-auto text-xs text-muted-foreground">
          Sincronizado em {new Date(lastSyncedAt).toLocaleString("pt-BR")}
        </span>
      )}
    </div>
  );
}

function HistoryCard({ history }: { history: OutboundMessageSummary[] }) {
  return (
    <Card className="gap-0 p-0">
      <div className="border-b border-border px-6 py-[18px]">
        <div className="text-base font-semibold tracking-[-0.01em]">
          Mensagens automáticas
        </div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          O que saiu — e o que não saiu, com o motivo.
        </div>
      </div>

      {history.length === 0 ? (
        <Empty
          icon={<Send className="size-5" />}
          title="Nada enviado ainda"
          desc="Lembretes e retomadas de contato aparecem aqui assim que houver horários marcados."
        />
      ) : (
        <ul className="divide-y divide-border">
          {history.map((message) => (
            <li key={message.id} className="flex gap-3 px-6 py-3">
              <div className="mt-0.5">
                {message.status === "enviado" ? (
                  <Send className="size-4" style={{ color: "var(--primary)" }} />
                ) : (
                  <CircleSlash className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">
                    {AUTOMATION_LABELS[message.kind]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {message.leadName ?? message.phone ?? "contato"}
                  </span>
                  {message.attempt > 1 && (
                    <span className="text-xs text-muted-foreground">
                      tentativa {message.attempt}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {message.body}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {describeOutcome(message)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const OUTCOME: Record<string, string> = {
  opt_out: "não enviada — o contato pediu para não receber mensagens automáticas",
  sem_telefone: "não enviada — o contato não tem telefone cadastrado",
  whatsapp_nao_configurado: "não enviada — o WhatsApp da empresa não está conectado",
  teto_diario: "não enviada — o limite diário de mensagens foi atingido",
  fora_da_janela: "não enviada — sairia fora do horário e chegaria tarde demais",
  ja_enviado: "não enviada — já havia sido enviada",
  cliente_respondeu: "não enviada — o cliente respondeu e a sequência parou",
  agendamento_mudou: "não enviada — o horário foi remarcado ou cancelado",
};

function describeOutcome(message: OutboundMessageSummary): string {
  if (message.status === "enviado" && message.sentAt) {
    return `Enviada em ${new Date(message.sentAt).toLocaleString("pt-BR")}`;
  }
  if (message.status === "pendente") {
    return `Agendada para ${new Date(message.scheduledFor).toLocaleString("pt-BR")}`;
  }
  if (message.status === "falhou") return "Falha no envio — será tentada de novo";
  if (message.reason) {
    return OUTCOME[message.reason] ?? `Não enviada (${message.reason})`;
  }
  return "Não enviada";
}

/** Situação do agendamento, com as cores já existentes de status. */
function AppointmentBadge({ status }: { status: AppointmentStatus }) {
  const tone =
    status === "faltou" || status === "cancelado"
      ? "status-abandonada"
      : status === "compareceu" || status === "confirmado"
        ? "status-agendada"
        : "status-em_andamento";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[5px] text-[12px] font-medium",
        tone,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {APPOINTMENT_STATUS_LABELS[status]}
    </span>
  );
}

function Empty({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <div className="text-sm font-semibold">{title}</div>
      <p className="max-w-[420px] text-[13px] text-muted-foreground">{desc}</p>
    </div>
  );
}

/** "sexta-feira, 12/09 às 14:30" no fuso do navegador. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  const time = date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} às ${time}`;
}

/** Janela AAAA-MM-DD de hoje até N dias à frente. */
function datesFor(days: number): { from: string; to: string } {
  const today = new Date();
  const end = new Date(today.getTime() + days * 24 * 3_600_000);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  return { from: key(today), to: key(end) };
}
