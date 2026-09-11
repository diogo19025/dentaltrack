"use client";

import {
  type ChatMessageDto,
  type ConversationDetail,
  supportsHandoff,
} from "@dentaltrack/shared";
import {
  Bell,
  Bot,
  Headphones,
  MessageCircle,
  RefreshCw,
  Send,
  User,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { HandoffBadge } from "@/components/ui/handoff-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tag } from "@/components/ui/tag";
import {
  useAssumeConversation,
  useConversationDetail,
  useReleaseConversation,
} from "@/hooks/use-conversations";
import { formatCaptured } from "@/lib/format";
import { cn } from "@/lib/utils";
import { whatsappUrl } from "@/lib/whatsapp";
import { SendReminderDialog } from "./send-reminder-dialog";

/**
 * Painel "ver mais" de uma conversa, aberto ao clicar numa linha de "Conversas
 * recentes" do dashboard. Mostra canal, status, tags detectadas (com confiança)
 * e o histórico de mensagens (cliente × bot), via `GET /conversations/:id`.
 */
export function ConversationDetailDialog({
  conversationId,
  onOpenChange,
}: {
  conversationId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError } = useConversationDetail(conversationId);

  return (
    <Dialog open={Boolean(conversationId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        {isLoading ? (
          <>
            <DialogHeader>
              <DialogTitle>Detalhes da conversa</DialogTitle>
              <DialogDescription>Carregando mensagens…</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3" aria-hidden="true">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </>
        ) : isError || !data ? (
          <>
            <DialogHeader>
              <DialogTitle>Detalhes da conversa</DialogTitle>
            </DialogHeader>
            <p role="alert" className="text-[13px] text-muted-foreground">
              Não foi possível carregar a conversa. Feche e tente novamente.
            </p>
          </>
        ) : (
          <ConversationDetailContent detail={data} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Conteúdo puro do painel (testável sem rede). */
export function ConversationDetailContent({
  detail,
}: {
  detail: ConversationDetail;
}) {
  const thread = detail.messages.filter((m) => m.role !== "system");
  const wa = whatsappUrl(detail.contactPhone);
  const truncated = detail.messageCount > thread.length;
  const [reminderOpen, setReminderOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const assume = useAssumeConversation(detail.id);
  const release = useReleaseConversation(detail.id);
  // O handoff só existe onde a IA de fato é pausada (hoje, WhatsApp). A regra
  // mora no `shared` porque a API recusa a mesma operação — ver `HANDOFF_CHANNELS`.
  const canHandoff = supportsHandoff(detail.channel);
  const handoffActive = detail.handoffAt !== null;
  const handoffPending = assume.isPending || release.isPending;
  const handoffError = assume.isError || release.isError;

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3 pr-6">
          <div className="min-w-0 flex-1 text-left">
            <DialogTitle className="text-base tracking-[-0.01em]">
              Detalhes da conversa
            </DialogTitle>
            <DialogDescription className="mt-[3px] text-[13px]">
              Iniciada {formatCaptured(detail.createdAt)}
            </DialogDescription>
          </div>
          <span className="inline-flex flex-none items-center rounded-full bg-muted px-2.5 py-[5px] text-[12px] font-medium text-muted-foreground">
            {detail.channel === "web" ? "Web" : "WhatsApp"}
          </span>
        </div>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-[480px]:grid-cols-1">
        <Field label="Status">
          <StatusBadge status={detail.status} />
        </Field>
        <Field label="Mensagens">
          <span className="tabular">{detail.messageCount}</span>
        </Field>
        <div className="col-span-full">
          <Field label="Responsável pelo atendimento">
            {canHandoff ? (
              <span className="flex flex-wrap items-center gap-2">
                <HandoffBadge active={handoffActive} />
                {handoffActive && detail.handoffAt && (
                  <span className="text-[12.5px] text-muted-foreground">
                    desde {formatCaptured(detail.handoffAt)}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">
                Conversa de teste — não há cliente do outro lado para assumir.
              </span>
            )}
          </Field>
        </div>
        <div className="col-span-full">
          <Field label="Tags detectadas">
            {detail.tags.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {detail.tags.map((t) => (
                  <Tag key={t.id} name={t.name} color={t.color} />
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">
                Nenhuma tag detectada ainda.
              </span>
            )}
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-self-start">
        {canHandoff && (
          <Button
            type="button"
            variant={handoffActive ? "outline" : "default"}
            disabled={handoffPending}
            onClick={() =>
              handoffActive ? release.mutate() : assume.mutate({})
            }
          >
            {handoffActive ? (
              <RefreshCw className="size-4" />
            ) : (
              <Headphones className="size-4" />
            )}
            {handoffPending
              ? "Atualizando…"
              : handoffActive
                ? "Devolver para IA"
                : "Assumir atendimento"}
          </Button>
        )}

        {wa && handoffActive && (
          <Button type="button" onClick={() => setReplyOpen(true)}>
            <Send className="size-4" /> Responder cliente
          </Button>
        )}

        {wa && !handoffActive && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setReminderOpen(true)}
          >
            <Bell className="size-4" /> Enviar lembrete
          </Button>
        )}

        {wa && (
          <Button asChild variant="outline" className="w-fit">
            <a href={wa} target="_blank" rel="noreferrer">
              <MessageCircle className="size-4" /> Abrir conversa no WhatsApp
            </a>
          </Button>
        )}
      </div>

      {handoffError && (
        <p role="alert" className="text-[12.5px] text-destructive">
          Não foi possível alterar quem responde esta conversa. Tente novamente.
        </p>
      )}

      {!wa && (
        <p className="text-[12.5px] text-muted-foreground">
          Sem telefone do contato — não dá para abrir esta conversa direto no
          WhatsApp.
        </p>
      )}

      {reminderOpen && (
        <SendReminderDialog
          conversationId={detail.id}
          open
          onOpenChange={setReminderOpen}
        />
      )}

      {replyOpen && (
        <SendReminderDialog
          conversationId={detail.id}
          purpose="reply"
          open
          onOpenChange={setReplyOpen}
        />
      )}

      <div>
        <SectionLabel>Últimas mensagens ({thread.length})</SectionLabel>
        {truncated && (
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Mostrando as últimas {thread.length} de {detail.messageCount}{" "}
            mensagens.
          </p>
        )}
        {thread.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Nenhuma mensagem registrada nesta conversa.
          </p>
        ) : (
          <ul role="list" className="mt-3 flex flex-col gap-3">
            {thread.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** Bolha de mensagem — espelha o estilo do chat (cliente à direita, bot à esquerda). */
function MessageBubble({ message }: { message: ChatMessageDto }) {
  const isUser = message.role === "user";
  return (
    <li
      className={cn(
        "flex items-end gap-2.5",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-primary-tint text-primary">
          <Bot className="size-4" />
        </span>
      )}
      <div
        className={cn(
          "max-w-[76%] whitespace-pre-wrap px-[14px] py-[11px] text-[14.5px] leading-[1.55] shadow-[var(--shadow-xs)]",
          isUser
            ? "rounded-[16px_16px_4px_16px] bg-primary text-white"
            : "rounded-[16px_16px_16px_4px] border border-border bg-card text-foreground",
        )}
      >
        {message.content}
      </div>
      {isUser && (
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-secondary text-muted-foreground">
          <User className="size-4" />
        </span>
      )}
    </li>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-[13.5px]">{children}</div>
    </div>
  );
}
