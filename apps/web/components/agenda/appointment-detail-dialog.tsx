"use client";

import { useState } from "react";
import {
  REVISABLE_APPOINTMENT_STATUSES,
  type AppointmentSource,
  type AppointmentSummary,
} from "@dentaltrack/shared";
import {
  Bell,
  CalendarClock,
  Clock,
  MessageCircle,
  MessagesSquare,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConversationDetailDialog } from "@/components/dashboard/conversation-detail-dialog";
import { SendReminderDialog } from "@/components/dashboard/send-reminder-dialog";
import {
  useCancelAppointment,
  useRescheduleAppointment,
} from "@/hooks/use-agenda";
import { ApiError, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { whatsappUrl } from "@/lib/whatsapp";
import { AppointmentBadge } from "./appointment-badge";
import {
  appointmentRange,
  formatDuration,
  formatHm,
  formatLongDay,
  toDatetimeLocal,
} from "./format";

const SOURCE_LABEL: Record<AppointmentSource, string> = {
  bot: "Marcado pelo assistente",
  integracao: "Veio do sistema de gestão",
  manual: "Marcado pela equipe",
};

type Revision = "cancelar" | "remarcar";

/**
 * Painel de um agendamento, aberto ao clicar num bloco da grade ou num card de
 * "Próximos". Concentra o que a recepção faz a partir de uma consulta marcada:
 * ver quem, o quê, com quem e quando; falar com o cliente (WhatsApp direto ou
 * lembrete pelo CRM, na conversa de origem); abrir a conversa; remarcar; e
 * cancelar.
 *
 * Cancelar e remarcar são da **equipe**, pela tela — o agente não recebe
 * nenhuma das duas como tool (P0.5). O cancelamento pede confirmação porque é
 * irreversível na agenda real da empresa; remarcar grava lá primeiro e, se a
 * agenda recusar, o horário antigo continua valendo e o erro aparece aqui.
 *
 * Fora do handoff de design; segue o design system existente (produto.md § Design).
 */
export function AppointmentDetailDialog({
  appointment,
  color,
  onOpenChange,
}: {
  appointment: AppointmentSummary | null;
  /** Cor do profissional, a mesma da grade — é a faixa no topo do painel. */
  color: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(appointment)} onOpenChange={onOpenChange}>
      {appointment && (
        <DialogContent
          key={appointment.id}
          className="gap-0 overflow-hidden p-0 sm:max-w-[520px]"
          overlayClassName="bg-black/30 backdrop-blur-[6px]"
        >
          <Details appointment={appointment} color={color} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Details({
  appointment,
  color,
}: {
  appointment: AppointmentSummary;
  color: string;
}) {
  const [reminderOpen, setReminderOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [revision, setRevision] = useState<Revision | null>(null);

  const cancel = useCancelAppointment();
  const reschedule = useRescheduleAppointment();
  const closeRevision = () => {
    setRevision(null);
    cancel.reset();
    reschedule.reset();
  };

  const range = appointmentRange(appointment);
  const wa = whatsappUrl(appointment.leadPhone);
  const revisable = (
    REVISABLE_APPOINTMENT_STATUSES as readonly string[]
  ).includes(appointment.status);
  // Congelado na abertura: o painel é remontado por agendamento (`key`), e
  // "já passou" não precisa virar durante os segundos em que ele fica aberto.
  const [openedAt] = useState(() => Date.now());
  const past = range ? range.endsAt.getTime() < openedAt : false;
  const who = appointment.leadName ?? "Sem nome";
  const what = appointment.procedureName ?? "Consulta";

  return (
    <>
      {/* Faixa do profissional — a mesma cor do bloco que foi clicado. */}
      <div aria-hidden="true" className="h-1.5" style={{ background: color }} />

      <div className="px-6 pb-5 pt-5">
        <DialogHeader className="gap-1.5 text-left">
          <div className="flex items-center gap-2 pr-8">
            <AppointmentBadge status={appointment.status} />
            <span className="truncate text-[12px] text-muted-foreground">
              {SOURCE_LABEL[appointment.source]}
            </span>
          </div>
          <DialogTitle className="text-[20px] leading-tight tracking-[-0.01em]">
            {what}
          </DialogTitle>
          <DialogDescription className="text-[14px]">
            {who}
            {appointment.professionalName && (
              <>
                {" · com "}
                <span className="text-foreground">
                  {appointment.professionalName}
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-sm)] bg-muted px-4 py-3">
          <span className="flex size-9 flex-none items-center justify-center rounded-full bg-card text-primary shadow-[var(--shadow-xs)]">
            {range ? (
              <CalendarClock className="size-4" />
            ) : (
              <Clock className="size-4" />
            )}
          </span>
          {range ? (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold first-letter:uppercase">
                {formatLongDay(range.startsAt)}
              </div>
              <div className="tabular text-[13px] text-muted-foreground">
                {formatHm(range.startsAt)} – {formatHm(range.endsAt)}
                {" · "}
                {formatDuration(range.startsAt, range.endsAt)}
                {past && " · já passou"}
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="text-sm font-semibold">Horário a combinar</div>
              <div className="truncate text-[13px] text-muted-foreground">
                {appointment.preferredTime
                  ? `Preferência: ${appointment.preferredTime}`
                  : "O cliente ainda não escolheu um horário."}
              </div>
            </div>
          )}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Cliente">{who}</Field>
          <Field label="Telefone">
            {appointment.leadPhone ? (
              <span className="tabular">{appointment.leadPhone}</span>
            ) : (
              <span className="text-muted-foreground">Não informado</span>
            )}
          </Field>
          <Field label="Profissional">
            {appointment.professionalName ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ background: color }}
                />
                {appointment.professionalName}
              </span>
            ) : (
              <span className="text-muted-foreground">Não definido</span>
            )}
          </Field>
          <Field label="Marcado em">
            <span className="tabular">
              {new Date(appointment.createdAt).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}
            </span>
          </Field>
          {appointment.canceledAt && (
            <Field label="Cancelado em">
              <span className="tabular">
                {new Date(appointment.canceledAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </Field>
          )}
          {appointment.externalId && (
            <Field label="Id na agenda da empresa">
              <span className="tabular break-all text-muted-foreground">
                {appointment.externalId}
              </span>
            </Field>
          )}
        </dl>
      </div>

      <div className="flex flex-col gap-3 border-t border-border bg-muted/50 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => setReminderOpen(true)}
            disabled={!appointment.conversationId}
          >
            <Bell className="size-4" /> Enviar lembrete
          </Button>
          {wa && (
            <Button asChild variant="outline">
              <a href={wa} target="_blank" rel="noreferrer">
                <MessageCircle className="size-4" /> Conversar no WhatsApp
              </a>
            </Button>
          )}
          {appointment.conversationId && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConversationOpen(true)}
            >
              <MessagesSquare className="size-4" /> Ver conversa
            </Button>
          )}
        </div>

        {!appointment.conversationId && (
          <p className="text-[12.5px] text-muted-foreground">
            {wa
              ? "Sem conversa vinculada — o lembrete pelo CRM sai a partir de uma conversa. Fale direto pelo WhatsApp."
              : "Sem telefone nem conversa vinculada. O contato veio do sistema de gestão sem esses dados."}
          </p>
        )}

        {revisable && (
          <div className="flex flex-wrap items-center gap-1 border-t border-border/70 pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRevision("remarcar")}
            >
              <CalendarClock className="size-4" /> Remarcar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setRevision("cancelar")}
            >
              <XCircle className="size-4" /> Cancelar agendamento
            </Button>
          </div>
        )}
      </div>

      {reminderOpen && appointment.conversationId && (
        <SendReminderDialog
          conversationId={appointment.conversationId}
          contactName={appointment.leadName}
          open
          onOpenChange={setReminderOpen}
        />
      )}

      {conversationOpen && appointment.conversationId && (
        <ConversationDetailDialog
          conversationId={appointment.conversationId}
          onOpenChange={(open) => {
            if (!open) setConversationOpen(false);
          }}
        />
      )}

      <Dialog
        open={revision === "cancelar"}
        onOpenChange={(open) => !open && closeRevision()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar este agendamento?</DialogTitle>
            <DialogDescription>
              {describe(appointment)}. O horário é liberado na agenda da empresa
              e os lembretes automáticos deixam de sair. Isso não pode ser
              desfeito.
            </DialogDescription>
          </DialogHeader>
          {cancel.isError && (
            <p role="alert" className="text-[13px] text-destructive">
              {revisionError(cancel.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeRevision}>
              Manter
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() =>
                cancel.mutate(appointment.id, { onSuccess: closeRevision })
              }
            >
              {cancel.isPending ? "Cancelando…" : "Cancelar agendamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revision === "remarcar"}
        onOpenChange={(open) => !open && closeRevision()}
      >
        {revision === "remarcar" && (
          <RescheduleForm
            appointment={appointment}
            saving={reschedule.isPending}
            error={reschedule.isError ? revisionError(reschedule.error) : null}
            onSave={(startsAt) =>
              reschedule.mutate(
                { id: appointment.id, startsAt },
                { onSuccess: closeRevision },
              )
            }
          />
        )}
      </Dialog>
    </>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm">{children}</dd>
    </div>
  );
}

function RescheduleForm({
  appointment,
  saving,
  error,
  onSave,
}: {
  appointment: AppointmentSummary;
  saving: boolean;
  error: string | null;
  onSave: (startsAtIso: string) => void;
}) {
  const [when, setWhen] = useState(
    appointment.startsAt ? toDatetimeLocal(appointment.startsAt) : "",
  );

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Remarcar agendamento</DialogTitle>
        <DialogDescription>
          {describe(appointment)}. O novo horário é gravado na agenda da
          empresa; os lembretes se ajustam sozinhos.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="appointment-when">Novo horário</Label>
        <Input
          id="appointment-when"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button
          type="button"
          onClick={() => onSave(new Date(when).toISOString())}
          disabled={saving || !when}
        >
          {saving ? "Salvando…" : "Remarcar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function describe(appointment: AppointmentSummary): string {
  const who = appointment.leadName ?? "Sem nome";
  const what = appointment.procedureName ?? "Consulta";
  const when = appointment.startsAt
    ? new Date(appointment.startsAt).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : (appointment.preferredTime ?? "sem horário definido");
  return `${what} de ${who}, ${when}`;
}

/**
 * Mensagem do servidor quando houver — é ela que diz o que a agenda da empresa
 * respondeu. O `requestId` vai junto para o suporte achar a chamada no log (P0.3).
 */
function revisionError(error: unknown): string {
  const fallback = "Não foi possível concluir agora. Tente de novo.";
  if (!(error instanceof ApiError)) return fallback;
  const message = errorMessage(error) || fallback;
  const suffix = error.requestId ? ` (código ${error.requestId})` : "";
  return `${message}${suffix}`;
}
