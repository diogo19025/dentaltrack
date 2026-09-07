"use client";

import { useMemo, useState } from "react";
import {
  AUTOMATION_LABELS,
  type OutboundMessageSummary,
} from "@dentaltrack/shared";
import {
  CalendarClock,
  CircleSlash,
  Clock,
  MoreHorizontal,
  Pencil,
  Search,
  Send,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import {
  useCancelOutboundMessage,
  useUpdateOutboundMessage,
} from "@/hooks/use-automations";
import { cn } from "@/lib/utils";

const FILTER_OPTIONS = [
  { value: "todas", label: "Todas" },
  { value: "pendente", label: "Programadas" },
  { value: "enviado", label: "Enviadas" },
  { value: "nao_enviadas", label: "Não enviadas" },
] as const;
type Filter = (typeof FILTER_OPTIONS)[number]["value"];

/**
 * Mensagens automáticas da empresa — o que está programado, o que saiu e o que
 * foi suprimido (com o motivo). As **programadas** são editáveis: o dono pode
 * ajustar o texto, adiar o envio ou cancelar antes de sair — o servidor
 * reencaixa qualquer novo horário na janela de envio (higiene anti-ban).
 */
export function ScheduledMessagesCard({
  history,
}: {
  history: OutboundMessageSummary[];
}) {
  const [filter, setFilter] = useState<Filter>("todas");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<OutboundMessageSummary | null>(null);

  const update = useUpdateOutboundMessage();
  const cancel = useCancelOutboundMessage();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return history.filter((message) => {
      if (filter === "pendente" && message.status !== "pendente") return false;
      if (filter === "enviado" && message.status !== "enviado") return false;
      if (
        filter === "nao_enviadas" &&
        !["suprimido", "falhou", "cancelado"].includes(message.status)
      ) {
        return false;
      }
      if (!term) return true;
      return [
        message.leadName,
        message.phone,
        message.body,
        AUTOMATION_LABELS[message.kind],
      ]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(term));
    });
  }, [history, filter, search]);

  const pendingCount = history.filter((m) => m.status === "pendente").length;

  const postpone = (message: OutboundMessageSummary, minutes: number) => {
    update.mutate(postponeInput(message, minutes));
  };

  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-[14px]">
        <div className="min-w-0">
          <div className="text-base font-semibold tracking-[-0.01em]">
            Mensagens automáticas
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {pendingCount > 0
              ? `${pendingCount} programada(s) para sair — dá para editar, adiar ou cancelar.`
              : "O que saiu — e o que não saiu, com o motivo."}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por contato ou texto"
              className="h-9 w-[220px] pl-8"
              aria-label="Buscar mensagem automática"
            />
          </div>
          <Segmented
            aria-label="Filtrar mensagens por situação"
            options={FILTER_OPTIONS}
            value={filter}
            onChange={setFilter}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <span className="text-muted-foreground">
            <Send className="size-5" />
          </span>
          <div className="text-sm font-semibold">
            {history.length === 0 ? "Nada enviado ainda" : "Nada neste filtro"}
          </div>
          <p className="max-w-[420px] text-[13px] text-muted-foreground">
            {history.length === 0
              ? "Lembretes e retomadas de contato aparecem aqui assim que houver horários marcados."
              : "Ajuste a busca ou o filtro para ver outras mensagens."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              busy={update.isPending || cancel.isPending}
              onEdit={() => setEditing(message)}
              onPostpone={(minutes) => postpone(message, minutes)}
              onCancel={() => cancel.mutate(message.id)}
            />
          ))}
        </ul>
      )}

      <EditMessageDialog
        message={editing}
        onClose={() => setEditing(null)}
        onSave={(input) => {
          if (!editing) return;
          update.mutate(
            { id: editing.id, ...input },
            { onSuccess: () => setEditing(null) },
          );
        }}
        saving={update.isPending}
      />
    </Card>
  );
}

function MessageRow({
  message,
  busy,
  onEdit,
  onPostpone,
  onCancel,
}: {
  message: OutboundMessageSummary;
  busy: boolean;
  onEdit: () => void;
  onPostpone: (minutes: number) => void;
  onCancel: () => void;
}) {
  const pending = message.status === "pendente";
  return (
    <li className="flex gap-3 px-6 py-3">
      <div className="mt-0.5">
        {message.status === "enviado" ? (
          <Send className="size-4" style={{ color: "var(--primary)" }} />
        ) : pending ? (
          <Clock className="size-4" style={{ color: "var(--primary)" }} />
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
          {pending && (
            <span className="rounded-full bg-primary-tint px-2 py-px text-[11px] font-medium text-primary">
              programada
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
          {message.body}
        </p>
        <p
          className={cn(
            "mt-0.5 text-xs",
            message.status === "falhou"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {describeOutcome(message)}
        </p>
      </div>

      {pending && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="self-center"
              aria-label="Ações da mensagem programada"
              disabled={busy}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="size-4" /> Editar mensagem…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPostpone(60)}>
              <Clock className="size-4" /> Adiar 1 hora
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onPostpone(24 * 60)}>
              <CalendarClock className="size-4" /> Adiar 1 dia
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onCancel}>
              <XCircle className="size-4" /> Cancelar envio
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function EditMessageDialog({
  message,
  onClose,
  onSave,
  saving,
}: {
  message: OutboundMessageSummary | null;
  onClose: () => void;
  onSave: (input: { body: string; scheduledFor: string }) => void;
  saving: boolean;
}) {
  // key={message.id} abaixo remonta o formulário a cada mensagem aberta.
  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && onClose()}>
      {message && (
        <EditMessageForm
          key={message.id}
          message={message}
          onSave={onSave}
          saving={saving}
        />
      )}
    </Dialog>
  );
}

function EditMessageForm({
  message,
  onSave,
  saving,
}: {
  message: OutboundMessageSummary;
  onSave: (input: { body: string; scheduledFor: string }) => void;
  saving: boolean;
}) {
  const [body, setBody] = useState(message.body);
  const [when, setWhen] = useState(toDatetimeLocal(message.scheduledFor));

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Editar mensagem programada</DialogTitle>
        <DialogDescription>
          {AUTOMATION_LABELS[message.kind]} para{" "}
          {message.leadName ?? message.phone ?? "contato"}. O horário final
          respeita a janela de envio configurada nas automações.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="outbound-body">Texto da mensagem</Label>
          <Textarea
            id="outbound-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={2000}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="outbound-when">Enviar em</Label>
          <Input
            id="outbound-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
      </div>

      <DialogFooter>
        <Button
          type="button"
          onClick={() =>
            onSave({
              body: body.trim(),
              scheduledFor: new Date(when).toISOString(),
            })
          }
          disabled={saving || body.trim().length === 0 || !when}
        >
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Adia a partir do horário previsto — ou de agora, se ele já passou. */
function postponeInput(message: OutboundMessageSummary, minutes: number) {
  const base = Math.max(new Date(message.scheduledFor).getTime(), Date.now());
  return {
    id: message.id,
    scheduledFor: new Date(base + minutes * 60_000).toISOString(),
  };
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
    return `Sai em ${new Date(message.scheduledFor).toLocaleString("pt-BR")}`;
  }
  if (message.status === "falhou") return "Falha no envio — será tentada de novo";
  if (message.status === "cancelado") return "Cancelada pela equipe";
  if (message.reason) {
    return OUTCOME[message.reason] ?? `Não enviada (${message.reason})`;
  }
  return "Não enviada";
}

/** ISO → valor aceito pelo input datetime-local, no fuso do navegador. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
