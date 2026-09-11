"use client";

import type { LeadDetail } from "@dentaltrack/shared";
import { BellOff, Bell, MessageCircle, ShieldOff } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OwnerOnly } from "@/components/auth/role-context";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tag } from "@/components/ui/tag";
import {
  useAnonymizeLead,
  useLeadDetail,
  useSetLeadOptOut,
} from "@/hooks/use-leads";
import { formatCaptured, initials, sourceLabel, timeAgo } from "@/lib/format";
import { TEMPERATURE_META } from "@/lib/lead-temperature";
import { whatsappUrl } from "@/lib/whatsapp";
import { ConversationDetailDialog } from "./conversation-detail-dialog";
import { SendReminderDialog } from "./send-reminder-dialog";

/**
 * Painel de detalhe do lead (FE-3.8), aberto ao clicar num lead da seção de
 * temperatura. Cada conversa listada expõe `id` + canal — é o ponto de
 * extensão para abrir a conversa direto no canal (WhatsApp, pós-MVP). Hoje o
 * atalho de contato é o deep-link wa.me pelo telefone do lead.
 */
export function LeadDetailDialog({
  leadId,
  onOpenChange,
}: {
  leadId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError } = useLeadDetail(leadId);

  return (
    <Dialog open={Boolean(leadId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        {isLoading ? (
          <>
            <DialogHeader>
              <DialogTitle>Detalhes do lead</DialogTitle>
              <DialogDescription>Carregando informações…</DialogDescription>
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
              <DialogTitle>Detalhes do lead</DialogTitle>
            </DialogHeader>
            <p role="alert" className="text-[13px] text-muted-foreground">
              Não foi possível carregar o lead. Feche e tente novamente.
            </p>
          </>
        ) : (
          <LeadDetailContent detail={data} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Conteúdo puro do painel (testável sem rede). */
export function LeadDetailContent({ detail }: { detail: LeadDetail }) {
  const meta = TEMPERATURE_META[detail.temperature];
  const wa = whatsappUrl(detail.phone);
  const [reminderOpen, setReminderOpen] = useState(false);
  // Conversa expandida (histórico de mensagens) a partir da lista abaixo.
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  // O lembrete vai para a conversa de WhatsApp mais recente do lead (se houver);
  // senão, a mais recente — o backend resolve o telefone (contato ou lead).
  const reminderConversationId =
    detail.conversations.find((c) => c.channel === "whatsapp")?.id ??
    detail.conversations[0]?.id ??
    null;

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3 pr-6">
          <Avatar className="size-10">
            <AvatarFallback className="bg-primary-tint text-[14px] font-semibold text-primary">
              {initials(detail.name, "L")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 text-left">
            <DialogTitle className="truncate text-base tracking-[-0.01em]">
              {detail.name ?? "Lead"}
            </DialogTitle>
            <DialogDescription className="mt-[3px] text-[13px]">
              Capturado {formatCaptured(detail.createdAt)} ·{" "}
              {sourceLabel(detail.source)}
            </DialogDescription>
          </div>
          <span
            className="tabular inline-flex flex-none items-center gap-1.5 rounded-full px-2.5 py-[5px] text-[12px] font-semibold"
            style={{ background: meta.bg, color: meta.fg }}
          >
            {meta.short} · {detail.score}
          </span>
        </div>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-[480px]:grid-cols-1">
        <Field label="Telefone">
          <span className="tabular">{detail.phone ?? "—"}</span>
        </Field>
        <Field label="E-mail">
          <span className="truncate">{detail.email ?? "—"}</span>
        </Field>
        <Field label="Interesse">{detail.interest ?? "—"}</Field>
        <Field label="Status">
          {detail.status ? <StatusBadge status={detail.status} /> : "—"}
        </Field>
        {detail.tags.length > 0 && (
          <div className="col-span-full">
            <Field label="Tags de interesse">
              <span className="flex flex-wrap gap-1.5">
                {detail.tags.map((t) => (
                  <Tag key={t.name} name={t.name} color={t.color} />
                ))}
              </span>
            </Field>
          </div>
        )}
      </div>

      {wa ? (
        <div className="flex flex-wrap items-center gap-2 justify-self-start">
          <Button
            type="button"
            className="w-fit"
            onClick={() => setReminderOpen(true)}
            disabled={!reminderConversationId}
          >
            <Bell className="size-4" /> Enviar lembrete
          </Button>
          <Button asChild variant="outline" className="w-fit">
            <a href={wa} target="_blank" rel="noreferrer">
              <MessageCircle className="size-4" /> Conversar no WhatsApp
            </a>
          </Button>
        </div>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">
          Sem telefone capturado — peça o contato na conversa para falar direto com o lead.
        </p>
      )}

      {reminderOpen && reminderConversationId && (
        <SendReminderDialog
          conversationId={reminderConversationId}
          contactName={detail.name}
          open
          onOpenChange={setReminderOpen}
        />
      )}

      <OwnerOnly>
        <PrivacySection detail={detail} />
      </OwnerOnly>

      <div>
        <SectionLabel>
          Conversas ({detail.conversations.length})
        </SectionLabel>
        {detail.conversations.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Nenhuma conversa registrada para este lead.
          </p>
        ) : (
          <ul role="list" className="mt-2 flex flex-col gap-2">
            {detail.conversations.map((convo) => (
              <li key={convo.id}>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setOpenConversationId(convo.id)}
                  className="w-fit min-w-[300px] max-w-full rounded-[12px] border border-border px-5 py-4 pr-8 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-[5px] text-[12px] font-medium text-muted-foreground">
                      {convo.channel === "web" ? "Web" : "WhatsApp"}
                    </span>
                    <StatusBadge status={convo.status} />
                    <span className="tabular text-[12px] text-muted-foreground">
                      {timeAgo(convo.lastMessageAt)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2.5">
                    <span className="tabular text-[12px] text-muted-foreground">
                      {convo.messageCount} {convo.messageCount === 1 ? "mensagem" : "mensagens"}
                    </span>
                    {convo.tags.map((t) => (
                      <Tag key={t.name} name={t.name} color={t.color} />
                    ))}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openConversationId && (
        <ConversationDetailDialog
          conversationId={openConversationId}
          onOpenChange={(open) => {
            if (!open) setOpenConversationId(null);
          }}
        />
      )}

      {detail.appointments.length > 0 && (
        <div>
          <SectionLabel>Agendamentos ({detail.appointments.length})</SectionLabel>
          <ul role="list" className="mt-2 flex flex-col gap-1.5">
            {detail.appointments.map((appt) => (
              <li key={appt.id} className="text-[13px]">
                <span className="font-medium">{appt.procedure ?? "Procedimento"}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {appt.preferredTime ?? "horário a combinar"} ·{" "}
                  {formatCaptured(appt.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
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

/**
 * Privacidade do contato (P1.5) — as duas ações que a LGPD exige, no lugar
 * onde a equipe já olha para o contato.
 *
 * Owner-only na tela, e também no servidor: esconder o botão é conveniência,
 * a barreira de segurança é a rota.
 */
function PrivacySection({ detail }: { detail: LeadDetail }) {
  const anonymize = useAnonymizeLead(detail.id);
  const optOut = useSetLeadOptOut(detail.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const anonymized = Boolean(detail.anonymizedAt);

  return (
    <div>
      <SectionLabel>Privacidade</SectionLabel>

      {anonymized ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Dados pessoais anonimizados a pedido em{" "}
          {formatCaptured(detail.anonymizedAt as string)}. O histórico de
          atendimento foi preservado.
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-muted-foreground">
          {detail.optedOut
            ? "Este contato pediu para não receber mensagens automáticas. Lembretes e automações não saem para ele."
            : "Este contato recebe lembretes e automações normalmente."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          disabled={optOut.isPending || anonymized || !detail.phone}
          onClick={() => optOut.mutate(!detail.optedOut)}
        >
          {detail.optedOut ? (
            <>
              <Bell className="size-4" /> Reativar mensagens
            </>
          ) : (
            <>
              <BellOff className="size-4" /> Descadastrar das automações
            </>
          )}
        </Button>

        {!anonymized && (
          <Button
            type="button"
            variant="outline"
            className="w-fit text-destructive"
            onClick={() => setConfirmOpen(true)}
          >
            <ShieldOff className="size-4" /> Anonimizar dados pessoais
          </Button>
        )}
      </div>

      {optOut.isError && (
        <p role="alert" className="mt-2 text-[12.5px] text-destructive">
          Não foi possível alterar o descadastro agora. Tente novamente.
        </p>
      )}

      {/* O texto da confirmação diz exatamente o que some e o que fica — é a
          diferença entre um clique consciente e um arrependimento. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        title="Anonimizar os dados deste contato?"
        description="Nome, telefone, e-mail e o conteúdo das mensagens serão removidos e não podem ser recuperados. Os agendamentos e as métricas do período continuam valendo, e o descadastro das automações é mantido."
        confirmLabel="Anonimizar"
        isPending={anonymize.isPending}
        error={anonymize.isError ? anonymize.error : undefined}
        onConfirm={() =>
          anonymize.mutate(undefined, {
            onSuccess: () => setConfirmOpen(false),
          })
        }
      />
    </div>
  );
}
