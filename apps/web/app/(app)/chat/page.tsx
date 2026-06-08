"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Bot,
  Circle,
  Clock,
  type LucideIcon,
  MessageCircle,
  Paperclip,
  RotateCw,
  Send,
  Sparkles,
  Tag as TagIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tag } from "@/components/ui/tag";
import { Textarea } from "@/components/ui/textarea";
import { useConversationDetail } from "@/hooks/use-conversations";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * /chat — réplica 1:1 de `screen_chat.jsx` (FE-1.1..1.5) com **streaming real**:
 * `useChat` (AI SDK) consome o SSE do NestJS (`/chat`). O contrato é
 * server-authoritative — o BE carrega o histórico do banco —, então só
 * mandamos `{ message, conversationId }`; o `conversationId` volta no header
 * `X-Conversation-Id`. Tags ao vivo do rail dependem do auto-tagging (F3).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const GREETING: UIMessage = {
  id: "greeting",
  role: "assistant",
  parts: [
    {
      type: "text",
      text: "Olá! Sou a assistente virtual da clínica. Posso tirar dúvidas sobre procedimentos, recomendar o tratamento ideal e agendar sua avaliação. Como posso te ajudar hoje?",
    },
  ],
};

const QUICK = [
  "Quero agendar uma consulta",
  "Ver procedimentos",
  "Saber sobre implante",
  "Estou com dor",
];

/** Concatena o texto das partes de uma mensagem (UIMessage). */
function messageText(m: UIMessage): string {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/**
 * conversationId atual (server-managed). Mutável em escopo de módulo — a tela
 * de chat é única e o valor é resetado ao montar (useEffect). Fica fora do
 * render para não violar as regras do React Compiler (refs/memoização).
 */
let currentConversationId: string | null = null;

/**
 * Transporte do useChat → NestJS (criado uma vez): Bearer fresco por request,
 * contrato `{ message, conversationId }` (server-authoritative) e captura do
 * conversationId pelo header `X-Conversation-Id` da resposta.
 */
const chatTransport = new DefaultChatTransport<UIMessage>({
  api: `${API_URL}/chat`,
  headers: async () => {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    const h: Record<string, string> = {};
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  },
  prepareSendMessagesRequest: ({ messages }) => {
    const last = messages[messages.length - 1];
    return {
      body: {
        message: last ? messageText(last) : "",
        conversationId: currentConversationId ?? undefined,
      },
    };
  },
  fetch: async (url, init) => {
    const res = await fetch(url, init);
    const cid = res.headers.get("X-Conversation-Id");
    if (cid) currentConversationId = cid;
    return res;
  },
});

export default function ChatPage() {
  const [input, setInput] = useState("");
  // Espelha o `currentConversationId` (módulo) em estado para acionar o fetch
  // das tags detectadas (auto-tagging F3) no rail.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();

  // Reseta o id (módulo) ao (re)montar a tela (nova sessão de chat). O estado
  // `conversationId` já nasce null a cada montagem (key={pathname} no shell).
  useEffect(() => {
    currentConversationId = null;
    return () => {
      currentConversationId = null;
    };
  }, []);

  const { messages, sendMessage, status, error, regenerate } = useChat({
    transport: chatTransport,
    messages: [GREETING],
    onFinish: () => {
      // Captura o id criado no 1º turno e refaz a busca das tags do rail. O
      // auto-tagging roda no servidor *após* a resposta (chamada de IA), então
      // um 2º invalidate com folga cobre essa latência.
      if (currentConversationId) setConversationId(currentConversationId);
      const invalidate = () =>
        void queryClient.invalidateQueries({ queryKey: ["conversations", "detail"] });
      invalidate();
      window.setTimeout(invalidate, 2500);
    },
  });
  const busy = status === "submitted" || status === "streaming";

  // Detalhe da conversa (status + tags detectadas) para o rail.
  const { data: detail } = useConversationDetail(conversationId);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    void sendMessage({ text: t });
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_296px] gap-[18px]">
      {/* Coluna do chat */}
      <Card className="flex min-h-0 flex-col gap-0 overflow-hidden p-0">
        {/* Header do bot */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="relative">
            <span className="flex size-[42px] items-center justify-center rounded-[12px] bg-primary-tint text-primary">
              <Bot className="size-[22px]" />
            </span>
            <span className="absolute -bottom-px -right-px size-3 rounded-full border-2 border-card bg-success" />
          </div>
          <div className="flex-1">
            <div className="text-[15px] font-semibold">Assistente · sua clínica</div>
            <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" /> Online · responde em segundos
            </div>
          </div>
          <StatusAndamento />
        </div>

        {/* Mensagens */}
        <div
          ref={scroller}
          className="flex flex-1 flex-col gap-4 overflow-y-auto bg-background px-5 py-6"
        >
          {messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
          {status === "submitted" && <TypingBubble />}
          {error && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-[var(--destructive-tint)] px-3.5 py-2.5 text-[13px] text-destructive">
              <span>Não foi possível responder agora. Sua mensagem foi salva.</span>
              <button
                type="button"
                onClick={() => void regenerate()}
                className="inline-flex items-center gap-1 font-medium hover:underline"
              >
                <RotateCw className="size-3.5" /> Tentar novamente
              </button>
            </div>
          )}
        </div>

        {/* Quick replies (só no estado inicial) */}
        {messages.length <= 1 && (
          <div className="flex flex-wrap gap-2 px-5 pb-3">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => submit(q)}
                className="anim-fade-up rounded-full bg-primary-tint px-[13px] py-2 text-[13px] font-medium text-primary transition-colors hover:bg-primary-tint-strong"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border bg-card px-4 py-[14px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            className="flex items-end gap-2.5"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 shrink-0 rounded-full text-muted-foreground"
              aria-label="Anexar"
            >
              <Paperclip className="size-[18px]" />
            </Button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              placeholder="Escreva sua mensagem…"
              rows={1}
              className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-[22px] bg-card px-[14px] py-[11px] focus-visible:border-primary focus-visible:ring-primary-tint"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || busy}
              className="size-[44px] shrink-0 rounded-full"
              aria-label="Enviar"
            >
              <Send className="size-[17px]" />
            </Button>
          </form>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="size-3" /> Respostas geradas por IA · canal Web
          </div>
        </div>
      </Card>

      {/* Rail lateral */}
      <div className="flex min-h-0 flex-col gap-[18px] overflow-y-auto">
        {/* Tags detectadas (auto-tagging F3 — ao vivo) */}
        <Card className="gap-0 p-[22px_24px]">
          <div className="mb-1 flex items-center gap-2">
            <TagIcon className="size-4 text-primary" />
            <div className="text-base font-semibold tracking-[-0.01em]">Tags detectadas</div>
          </div>
          <p className="mb-4 text-[12.5px] text-muted-foreground">
            Interesses classificados pela IA nesta conversa.
          </p>
          {detail && detail.tags.length > 0 ? (
            <div className="flex flex-col gap-3.5">
              {detail.tags.map((t) => {
                const pct = Math.round(t.confidence * 100);
                return (
                  <div key={t.id}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <Tag name={t.name} color={t.color} />
                      <span className="tabular text-[12px] text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[13px] text-muted-foreground">Nenhuma tag ainda.</div>
          )}
        </Card>

        {/* Resumo da conversa */}
        <Card className="gap-0 p-[22px_24px]">
          <div className="mb-3.5 text-base font-semibold tracking-[-0.01em]">Resumo da conversa</div>
          <SummaryRow
            icon={Circle}
            label="Status"
            value={<StatusBadge status={detail?.status ?? "em_andamento"} />}
          />
          <div className="my-3 h-px bg-border" />
          <SummaryRow
            icon={MessageCircle}
            label="Mensagens"
            value={<span className="tabular">{messages.length}</span>}
          />
          <div className="my-3 h-px bg-border" />
          <SummaryRow
            icon={Clock}
            label="Início"
            value={<span className="text-muted-foreground">agora</span>}
          />
          <div className="my-3 h-px bg-border" />
          <SummaryRow
            icon={MessageCircle}
            label="Canal"
            value={
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                Web
              </span>
            }
          />
        </Card>

        {/* Sugestão do agente */}
        <Card className="gap-0 border-primary-tint-strong bg-primary-tint p-[22px_24px]">
          <div className="flex gap-2.5">
            <Sparkles className="mt-0.5 size-[18px] shrink-0 text-primary" />
            <div>
              <div className="text-sm font-semibold" style={{ color: "var(--primary-active)" }}>
                Sugestão do agente
              </div>
              <div
                className="mt-1 text-[12.5px] leading-relaxed"
                style={{ color: "var(--primary-active)", opacity: 0.85 }}
              >
                Conduza o paciente para uma avaliação inicial sempre que houver interesse em um
                procedimento.
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Badge "Em andamento" (status-andamento). */
function StatusAndamento() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: "var(--status-andamento-tint)", color: "var(--status-andamento)" }}
    >
      <span className="size-1.5 rounded-full bg-current" /> Em andamento
    </span>
  );
}

/** Bolha de mensagem (usuário à direita = primary; bot à esquerda = card+borda). */
function Bubble({ m }: { m: UIMessage }) {
  const isUser = m.role === "user";
  const text = messageText(m);
  const isStreaming = m.parts.some((p) => p.type === "text" && p.state === "streaming");

  return (
    <div className={cn("anim-fade-up flex items-end gap-2.5", isUser ? "justify-end" : "justify-start")}>
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
        {text}
        {isStreaming && (
          <span
            className="ml-0.5 inline-block h-[15px] w-[7px] rounded-[2px] bg-primary align-[-2px]"
            style={{ animation: "blink 1s infinite" }}
          />
        )}
      </div>
    </div>
  );
}

/** "Typing" de 3 pontos enquanto a resposta não começou a chegar. */
function TypingBubble() {
  return (
    <div className="anim-fade flex items-end gap-2.5">
      <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-primary-tint text-primary">
        <Bot className="size-4" />
      </span>
      <div className="flex gap-[5px] rounded-[16px_16px_16px_4px] border border-border bg-card px-4 py-[13px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-[7px] rounded-full bg-muted-foreground"
            style={{ animation: `blink 1.2s ${i * 0.18}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Linha do "Resumo da conversa" (ícone + label à esquerda, valor à direita). */
function SummaryRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2.5 text-[13.5px] text-muted-foreground">
        <Icon className="size-[15px]" />
        {label}
      </span>
      {value}
    </div>
  );
}
