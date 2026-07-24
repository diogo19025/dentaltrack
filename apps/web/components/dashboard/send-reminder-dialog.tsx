"use client";

import { REMINDER_MAX_LENGTH, type ReminderBlocker } from "@dentaltrack/shared";
import { Check } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useReminderContext, useSendReminder } from "@/hooks/use-reminders";

/** Por que o envio está bloqueado → texto de ajuda acionável para o operador. */
const BLOCKER_NOTE: Record<ReminderBlocker, string> = {
  no_phone:
    "Este contato não tem telefone capturado. Peça o contato na conversa para enviar um lembrete.",
  whatsapp_not_configured:
    "Conecte o WhatsApp da empresa em Configurações para enviar lembretes pelo CRM.",
};

/**
 * Caixa de "Enviar lembrete" — envia uma mensagem proativa por WhatsApp, do
 * próprio CRM, referenciando a conversa do cliente. Pré-preenche um rascunho
 * editável (vindo do servidor) e mostra a elegibilidade. Compartilhada pelo
 * painel do lead e pelo painel de "Conversas recentes". Os painéis montam este
 * componente só quando aberto (a busca de contexto roda sob demanda).
 */
export function SendReminderDialog({
  conversationId,
  contactName,
  open,
  onOpenChange,
}: {
  conversationId: string | null;
  contactName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ctx = useReminderContext(open ? conversationId : null);
  const send = useSendReminder(conversationId);
  // O rascunho vem do servidor; assim que o operador edita, passamos a usar o
  // texto digitado. Cada abertura monta o componente do zero (os painéis montam
  // sob demanda), então o valor é derivado no render — sem sincronizar via efeito.
  const [typed, setTyped] = useState("");
  const [dirty, setDirty] = useState(false);
  const message = dirty ? typed : (ctx.data?.draft ?? "");

  const canSend = ctx.data?.canSend ?? false;
  const trimmed = message.trim();
  const firstName = contactName?.trim().split(/\s+/)[0];

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend || send.isPending || trimmed.length === 0) return;
    send.mutate(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Enviar lembrete</DialogTitle>
          <DialogDescription>
            {ctx.data?.phone ? (
              <>
                Mensagem por WhatsApp para{" "}
                <span className="tabular">{ctx.data.phone}</span>
              </>
            ) : (
              "Mensagem por WhatsApp ao contato desta conversa."
            )}
          </DialogDescription>
        </DialogHeader>

        {send.isSuccess ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary-tint text-primary">
              <Check className="size-5" />
            </span>
            <p className="text-[14px] font-medium">
              Lembrete enviado{firstName ? ` para ${firstName}` : ""}.
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </div>
        ) : ctx.isLoading ? (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : ctx.isError ? (
          <p role="alert" className="text-[13px] text-muted-foreground">
            Não foi possível preparar o lembrete. Feche e tente novamente.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            {!canSend && ctx.data?.reason && (
              <p
                role="note"
                className="rounded-md bg-primary-tint px-3 py-2.5 text-[12.5px] text-primary"
              >
                {BLOCKER_NOTE[ctx.data.reason]}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="reminder-message"
                className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground"
              >
                Mensagem
              </label>
              <Textarea
                id="reminder-message"
                value={message}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setDirty(true);
                }}
                rows={5}
                maxLength={REMINDER_MAX_LENGTH}
                disabled={!canSend || send.isPending}
                placeholder="Escreva o lembrete…"
              />
              <span className="tabular self-end text-[11.5px] text-muted-foreground">
                {message.length}/{REMINDER_MAX_LENGTH}
              </span>
            </div>

            {send.isError && (
              <p role="alert" className="text-[12.5px] text-destructive">
                Não foi possível enviar o lembrete agora. Tente novamente.
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!canSend || send.isPending || trimmed.length === 0}
              >
                {send.isPending ? "Enviando…" : "Enviar lembrete"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
