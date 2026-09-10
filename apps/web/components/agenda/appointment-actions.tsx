"use client";

import { useState } from "react";
import {
  REVISABLE_APPOINTMENT_STATUSES,
  type AppointmentSummary,
} from "@dentaltrack/shared";
import { CalendarClock, MoreHorizontal, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCancelAppointment,
  useRescheduleAppointment,
} from "@/hooks/use-agenda";
import { ApiError } from "@/lib/api-client";

/**
 * Cancelar e remarcar um agendamento (P0.5) — as duas operações que não
 * existiam em nenhuma camada até o PR 3. São da **equipe**, pela tela; o agente
 * não recebe nenhuma das duas como tool.
 *
 * O cancelamento pede confirmação porque é irreversível na agenda real da
 * empresa (o evento é apagado no Google; no Clinicorp, cancelado). Remarcar
 * abre um dialog com o novo horário; o servidor grava na agenda real primeiro
 * e, se ela recusar, o horário antigo continua valendo — o erro aparece aqui.
 */
export function AppointmentActions({
  appointment,
}: {
  appointment: AppointmentSummary;
}) {
  const [dialog, setDialog] = useState<"cancelar" | "remarcar" | null>(null);
  const cancel = useCancelAppointment();
  const reschedule = useRescheduleAppointment();

  const revisable = (
    REVISABLE_APPOINTMENT_STATUSES as readonly string[]
  ).includes(appointment.status);
  if (!revisable) return null;

  const close = () => {
    setDialog(null);
    cancel.reset();
    reschedule.reset();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-1.5 -mt-1 size-7"
            aria-label="Ações do agendamento"
            disabled={cancel.isPending || reschedule.isPending}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("remarcar")}>
            <CalendarClock className="size-4" /> Remarcar…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDialog("cancelar")}
          >
            <XCircle className="size-4" /> Cancelar agendamento…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dialog === "cancelar"}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar este agendamento?</DialogTitle>
            <DialogDescription>
              {describe(appointment)}. O horário é liberado na agenda da
              empresa e os lembretes automáticos deixam de sair. Isso não pode
              ser desfeito.
            </DialogDescription>
          </DialogHeader>
          {cancel.isError && (
            <p role="alert" className="text-[13px] text-destructive">
              {errorMessage(cancel.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Manter
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() =>
                cancel.mutate(appointment.id, { onSuccess: close })
              }
            >
              {cancel.isPending ? "Cancelando…" : "Cancelar agendamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "remarcar"}
        onOpenChange={(open) => !open && close()}
      >
        {dialog === "remarcar" && (
          <RescheduleForm
            key={appointment.id}
            appointment={appointment}
            saving={reschedule.isPending}
            error={reschedule.isError ? errorMessage(reschedule.error) : null}
            onSave={(startsAt) =>
              reschedule.mutate(
                { id: appointment.id, startsAt },
                { onSuccess: close },
              )
            }
          />
        )}
      </Dialog>
    </>
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
 * respondeu. O corpo de erro do Nest é JSON com `message`; o `requestId` vai
 * junto para o suporte achar a chamada no log (P0.3).
 */
function errorMessage(error: unknown): string {
  const fallback = "Não foi possível concluir agora. Tente de novo.";
  if (!(error instanceof ApiError)) return fallback;
  let message = error.message;
  try {
    const parsed = JSON.parse(error.message) as { message?: unknown };
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    /* corpo não era JSON — usa o texto como veio */
  }
  const suffix = error.requestId ? ` (código ${error.requestId})` : "";
  return `${message || fallback}${suffix}`;
}

/** ISO → valor aceito pelo input datetime-local, no fuso do navegador. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
