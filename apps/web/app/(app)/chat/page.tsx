"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Bot,
  Circle,
  Clock,
  type LucideIcon,
  MessageCircle,
  Paperclip,
  Send,
  Sparkles,
  Tag as TagIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { tagClass } from "@/lib/tags";
import { cn } from "@/lib/utils";

/**
 * /chat — réplica 1:1 de `screen_chat.jsx` (FE-1.1/1.2/1.4/1.5).
 * NOTA: o streaming aqui é um MOCK (typewriter local) só para a estrutura/visual.
 * Na Etapa 5 ele é trocado por `useChat` consumindo o SSE do NestJS, sem mexer
 * nos componentes de bolha/layout.
 */

const BOT_REPLIES = {
  default:
    "Claro! Posso te ajudar com isso. Para entender melhor, você está com algum incômodo específico ou busca um procedimento estético? Assim já consigo te orientar e, se quiser, agendar uma avaliação.",
  agendar:
    "Perfeito! Vou organizar seu agendamento. Para qual procedimento você gostaria de marcar? E qual a melhor faixa de horário pra você — manhã ou tarde?",
  procedimentos:
    "Nós oferecemos diversos tratamentos. Os mais procurados são implante dentário, clareamento, facetas de porcelana e ortodontia. Sobre qual deles você gostaria de saber a descrição, a duração e a faixa de investimento?",
  implante:
    "O implante dentário repõe o dente perdido com uma raiz de titânio e uma coroa sobre ela. A avaliação inicial é fundamental para verificar o osso. Que tal agendarmos uma avaliação para um plano personalizado?",
} as const;

type ReplyKey = keyof typeof BOT_REPLIES;

function pickReply(text: string): { key: ReplyKey; tags: string[] } {
  const t = text.toLowerCase();
  if (/agend|marc|consult|hor[aá]rio/.test(t)) return { key: "agendar", tags: ["agendamento"] };
  if (/implante/.test(t)) return { key: "implante", tags: ["implante"] };
  if (/procedi|tratam|servi|op[çc]/.test(t)) return { key: "procedimentos", tags: [] };
  if (/clarea/.test(t)) return { key: "default", tags: ["clareamento"] };
  if (/dor|urg/.test(t)) return { key: "default", tags: ["dor/urgência"] };
  return { key: "default", tags: [] };
}

type ChatMessage = { role: "user" | "assistant"; text: string; streaming?: boolean };
type DetectedTag = { name: string; conf: number };

const QUICK = [
  "Quero agendar uma consulta",
  "Ver procedimentos",
  "Saber sobre implante",
  "Estou com dor",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Olá! Sou a Sofia, assistente virtual da Clínica Sorriso Pleno. Posso tirar dúvidas sobre procedimentos, recomendar o tratamento ideal e agendar sua avaliação. Como posso te ajudar hoje?",
    },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [detectedTags, setDetectedTags] = useState<DetectedTag[]>([{ name: "avaliação", conf: 0.74 }]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || streaming) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    const { key, tags } = pickReply(text);
    setStreaming(true);

    setTimeout(() => {
      const full = BOT_REPLIES[key];
      setMessages((m) => [...m, { role: "assistant", text: "", streaming: true }]);
      let i = 0;
      const id = setInterval(() => {
        i += 2;
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = { role: "assistant", text: full.slice(0, i), streaming: i < full.length };
          return c;
        });
        if (i >= full.length) {
          clearInterval(id);
          setStreaming(false);
          if (tags.length) {
            setDetectedTags((d) => {
              const names = new Set(d.map((x) => x.name));
              const add = tags
                .filter((t) => !names.has(t))
                .map((t) => ({ name: t, conf: 0.8 + Math.random() * 0.18 }));
              return [...d, ...add];
            });
          }
        }
      }, 18);
    }, 650);
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
            <div className="text-[15px] font-semibold">Assistente · Clínica Sorriso Pleno</div>
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
          {messages.map((m, i) => (
            <Bubble key={i} m={m} />
          ))}
          {streaming && messages[messages.length - 1]?.role === "user" && <TypingBubble />}
        </div>

        {/* Quick replies (só no estado inicial) */}
        {messages.length <= 2 && (
          <div className="flex flex-wrap gap-2 px-5 pb-3">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
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
              send();
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
                  send();
                }
              }}
              placeholder="Escreva sua mensagem…"
              rows={1}
              className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-[22px] bg-card px-[14px] py-[11px] focus-visible:border-primary focus-visible:ring-primary-tint"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || streaming}
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
        {/* Tags detectadas */}
        <Card className="gap-0 p-[22px_24px]">
          <div className="mb-1 flex items-center gap-2">
            <TagIcon className="size-4 text-primary" />
            <div className="text-base font-semibold tracking-[-0.01em]">Tags detectadas</div>
          </div>
          <p className="mb-4 text-[12.5px] text-muted-foreground">
            Interesses classificados pela IA nesta conversa.
          </p>
          <div className="flex flex-col gap-3">
            {detectedTags.map((t) => (
              <div key={t.name} className="anim-fade-up">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className={cn("tag", tagClass(t.name))}>
                    <span className="tag-d" />
                    {t.name}
                  </span>
                  <span className="tabular text-xs text-muted-foreground">
                    {Math.round(t.conf * 100)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${t.conf * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {detectedTags.length === 0 && (
              <div className="text-[13px] text-muted-foreground">Nenhuma tag ainda.</div>
            )}
          </div>
        </Card>

        {/* Resumo da conversa */}
        <Card className="gap-0 p-[22px_24px]">
          <div className="mb-3.5 text-base font-semibold tracking-[-0.01em]">Resumo da conversa</div>
          <SummaryRow icon={Circle} label="Status" value={<StatusAndamento />} />
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
                Paciente com interesse inicial — conduza para a avaliação gratuita de junho.
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
function Bubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";
  return (
    <div className={cn("anim-fade-up flex items-end gap-2.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-primary-tint text-primary">
          <Bot className="size-4" />
        </span>
      )}
      <div
        className={cn(
          "max-w-[76%] px-[14px] py-[11px] text-[14.5px] leading-[1.55] shadow-[var(--shadow-xs)]",
          isUser
            ? "rounded-[16px_16px_4px_16px] bg-primary text-white"
            : "rounded-[16px_16px_16px_4px] border border-border bg-card text-foreground",
        )}
      >
        {m.text}
        {m.streaming && (
          <span
            className="ml-0.5 inline-block h-[15px] w-[7px] rounded-[2px] bg-primary align-[-2px]"
            style={{ animation: "blink 1s infinite" }}
          />
        )}
      </div>
    </div>
  );
}

/** "Typing" de 3 pontos enquanto a resposta não começou. */
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
