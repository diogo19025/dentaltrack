"use client";

import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import {
  Bot,
  Clock,
  MessageCircle,
  Mic,
  Paperclip,
  RotateCw,
  Send,
  Sparkles,
  Square,
  Tag as TagIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tag } from "@/components/ui/tag";
import { Textarea } from "@/components/ui/textarea";
import { useConversationDetail } from "@/hooks/use-conversations";
import { useSettings } from "@/hooks/use-settings";
import { useVoiceInput } from "@/hooks/use-voice-input";
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
      text: "Olá! Sou a assistente virtual da empresa. Posso tirar dúvidas sobre procedimentos, recomendar o tratamento ideal e agendar sua avaliação. Como posso te ajudar hoje?",
    },
  ],
};

const QUICK = [
  "Quero agendar um atendimento",
  "Ver procedimentos",
  "Saber valores",
  "Tirar uma dúvida",
];

/** Concatena o texto das partes de uma mensagem (UIMessage). */
function messageText(m: UIMessage): string {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** Parte de áudio (mensagem de voz) de uma UIMessage, se houver. */
function audioPart(m: UIMessage): FileUIPart | undefined {
  for (const p of m.parts) {
    if (p.type === "file" && p.mediaType.startsWith("audio/")) return p;
  }
  return undefined;
}

/**
 * conversationId atual (server-managed). Mutável em escopo de módulo — a tela
 * de chat é única e o valor é resetado ao montar (useEffect). Fica fora do
 * render para não violar as regras do React Compiler (refs/memoização).
 */
let currentConversationId: string | null = null;

/**
 * Transcrição do último turno por áudio (header `X-Transcript`, URI-encoded).
 * Mesmo padrão do `currentConversationId`: módulo, fora do render. A
 * reatribuição fica nesta função (e não no onFinish) por causa das regras do
 * React Compiler (sem reassign de variável externa dentro do componente).
 */
let lastTranscript: string | null = null;

/** Lê e zera a transcrição pendente do turno que acabou de terminar. */
function consumeTranscript(): string | null {
  const transcript = lastTranscript;
  lastTranscript = null;
  return transcript;
}

/**
 * Transporte do useChat → NestJS (criado uma vez): Bearer fresco por request,
 * contrato server-authoritative — `{ message, conversationId }` para texto ou
 * `{ audio, audioType, conversationId }` para mensagem de voz (o servidor
 * transcreve) — e captura dos headers `X-Conversation-Id` / `X-Transcript`.
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
    const voice = last ? audioPart(last) : undefined;
    return {
      body: voice
        ? {
            // Remove o prefixo "data:<mime>;base64," — a API recebe base64 puro.
            audio: voice.url.slice(voice.url.indexOf(",") + 1),
            audioType: voice.mediaType,
            conversationId: currentConversationId ?? undefined,
          }
        : {
            message: last ? messageText(last) : "",
            conversationId: currentConversationId ?? undefined,
          },
    };
  },
  fetch: async (url, init) => {
    const res = await fetch(url, init);
    const cid = res.headers.get("X-Conversation-Id");
    if (cid) currentConversationId = cid;
    const transcript = res.headers.get("X-Transcript");
    lastTranscript = transcript ? decodeURIComponent(transcript) : null;
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
    lastTranscript = null;
    return () => {
      currentConversationId = null;
      lastTranscript = null;
    };
  }, []);

  const { messages, sendMessage, setMessages, status, error, regenerate } = useChat({
    transport: chatTransport,
    messages: [GREETING],
    onFinish: () => {
      // Captura o id criado no 1º turno e refaz a busca das tags do rail. O
      // auto-tagging roda no servidor *após* a resposta (chamada de IA), então
      // um 2º invalidate com folga cobre essa latência.
      if (currentConversationId) setConversationId(currentConversationId);
      // Turno por áudio: anexa a transcrição (header X-Transcript) à bolha de
      // voz — o cliente vê o que o bot entendeu.
      const transcript = consumeTranscript();
      if (transcript) {
        setMessages((prev) => {
          const idx = prev.findLastIndex((m) => m.role === "user" && audioPart(m));
          if (idx < 0 || prev[idx].parts.some((p) => p.type === "text")) return prev;
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            parts: [...next[idx].parts, { type: "text", text: transcript }],
          };
          return next;
        });
      }
      const invalidate = () =>
        void queryClient.invalidateQueries({ queryKey: ["conversations", "detail"] });
      invalidate();
      window.setTimeout(invalidate, 2500);
    },
  });
  const busy = status === "submitted" || status === "streaming";

  // Entrada por voz: o áudio gravado É a mensagem do turno — vai como file part
  // no useChat (bolha com player) e como base64 no body; o servidor transcreve
  // e o bot responde em texto.
  const voice = useVoiceInput(({ dataUrl, mediaType }) => {
    void sendMessage({
      files: [{ type: "file", mediaType, url: dataUrl, filename: "mensagem-de-voz" }],
    });
  });

  // Detalhe da conversa (status + tags detectadas) para o rail.
  const { data: detail } = useConversationDetail(conversationId);
  // Identidade da empresa (header) + oferta ativa (card de sugestão), como no mock.
  const { data: settings } = useSettings();

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
            <div className="text-[15px] font-semibold">
              Assistente · {settings?.clinicName || "sua empresa"}
            </div>
            <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" /> Online · responde em segundos
            </div>
          </div>
          <StatusAndamento />
        </div>

        {/* Mensagens */}
        <div
          ref={scroller}
          role="log"
          aria-label="Mensagens da conversa"
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

        {/* Quick replies (estado inicial; seguem visíveis durante o 1º "digitando") */}
        {messages.length <= 2 && (
          <div className="flex flex-wrap gap-2 px-5 pb-3">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => submit(q)}
                className="anim-fade-up rounded-full border border-transparent bg-primary-tint px-[13px] py-2 text-[13px] font-medium text-primary transition-colors outline-none hover:bg-primary-tint-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              size="icon-sm"
              className="shrink-0"
              aria-label="Anexar"
            >
              <Paperclip />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                if (voice.status === "recording") voice.stop();
                else void voice.start();
              }}
              disabled={voice.status !== "recording" && busy}
              aria-label={
                voice.status === "recording"
                  ? "Parar e enviar a mensagem de voz"
                  : "Gravar mensagem de voz"
              }
              className={cn(
                "shrink-0",
                voice.status === "recording" &&
                  "bg-[var(--destructive-tint)] text-destructive hover:bg-[var(--destructive-tint)] hover:text-destructive",
              )}
            >
              {voice.status === "recording" ? (
                <Square className="animate-pulse fill-current" />
              ) : (
                <Mic />
              )}
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
              className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-full bg-card px-[14px] py-[11px]"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || busy}
              className="shrink-0 rounded-full"
              aria-label="Enviar"
            >
              <Send />
            </Button>
          </form>
          <div
            aria-live="polite"
            className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground"
          >
            {voice.status === "recording" ? (
              <>
                <Mic className="size-3 text-destructive" /> Gravando… clique no quadrado para
                enviar a mensagem de voz
              </>
            ) : voice.error ? (
              <span className="text-destructive">{voice.error}</span>
            ) : (
              <>
                <Sparkles className="size-3" /> Respostas geradas por IA · canal Web
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Rail lateral */}
      <div className="flex min-h-0 flex-col gap-[18px] overflow-y-auto">
        {/* Tags detectadas (auto-tagging F3 — ao vivo) */}
        <Card className="gap-0 p-[22px_24px]">
          <div className="mb-1 flex items-center gap-2">
            <TagIcon className="size-4 text-primary" />
            <div className="text-base font-semibold leading-[1.2] tracking-[-0.01em]">
              Tags detectadas
            </div>
          </div>
          <p className="mb-4 text-[12.5px] text-muted-foreground">
            Interesses classificados pela IA nesta conversa.
          </p>
          {detail && detail.tags.length > 0 ? (
            <div className="flex flex-col gap-3">
              {detail.tags.map((t) => {
                const pct = Math.round(t.confidence * 100);
                return (
                  <div key={t.id} className="anim-fade-up">
                    <div className="mb-1.5 flex items-center justify-between">
                      <Tag name={t.name} color={t.color} />
                      <span className="tabular text-[12px] text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary [transition:width_.6s_cubic-bezier(.22,.61,.36,1)]"
                        style={{ width: `${pct}%` }}
                      />
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
          <div className="mb-3.5 text-base font-semibold leading-[1.2] tracking-[-0.01em]">
            Resumo da conversa
          </div>
          <SummaryRow
            icon={DotIcon}
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
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-[5px] text-xs font-medium text-muted-foreground">
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
                className="mt-1 text-[12.5px] leading-[1.5]"
                style={{ color: "var(--primary-active)", opacity: 0.85 }}
              >
                {settings?.offerEnabled && settings.offerText
                  ? `Cliente com interesse inicial — conduza para a ${settings.offerText.replace(/\.$/, "")}.`
                  : "Conduza o cliente para uma avaliação inicial sempre que houver interesse em um procedimento."}
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
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[5px] text-xs font-medium"
      style={{ background: "var(--status-andamento-tint)", color: "var(--status-andamento)" }}
    >
      <span className="size-1.5 rounded-full bg-current" /> Em andamento
    </span>
  );
}

/** Ponto preenchido (réplica do `IcDot` do handoff — o lucide `Circle` é um anel). */
function DotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
    </svg>
  );
}

/**
 * Bolha de mensagem (usuário à direita = primary; bot à esquerda = card+borda).
 * Mensagem de voz: player de áudio + a transcrição (o que o bot entendeu)
 * quando ela chega no fim do turno.
 */
function Bubble({ m }: { m: UIMessage }) {
  const isUser = m.role === "user";
  const text = messageText(m);
  const voice = audioPart(m);
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
        {voice && (
          <span className="flex items-center gap-2">
            <Mic className="size-4 shrink-0" aria-hidden="true" />
            <audio controls src={voice.url} className="h-10 w-[230px] max-w-full" />
          </span>
        )}
        {voice ? (
          text && <span className="mt-1.5 block text-[13px] italic opacity-90">{text}</span>
        ) : (
          <>
            {text}
            {isStreaming && (
              <span
                className="ml-0.5 inline-block h-[15px] w-[7px] rounded-[2px] bg-primary align-[-2px]"
                style={{ animation: "blink 1s infinite" }}
              />
            )}
          </>
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
function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-[9px] text-[13.5px] text-muted-foreground">
        <Icon className="size-[15px]" />
        {label}
      </span>
      {value}
    </div>
  );
}
