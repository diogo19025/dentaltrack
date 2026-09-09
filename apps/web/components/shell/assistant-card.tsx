"use client";

import Link from "next/link";
import { Sparkles, X } from "lucide-react";
import { useDismissed } from "@/hooks/use-dismissed";

/**
 * Cartão "Assistente ativo" do rodapé da sidebar (handoff: `app.jsx`).
 *
 * No design ele é fixo; aqui aparece **uma vez por login** e pode ser
 * dispensado — pelo X ou ao clicar em "Configurar". A dispensa fica no
 * navegador amarrada ao id do login (`sessionId`): não volta a cada navegação
 * nem a cada F5, e reaparece no próximo login. Sem `sessionId` (token sem o
 * claim), a dispensa vale para o navegador inteiro.
 */
export const ASSISTANT_CARD_KEY = "assistant-card";

export function AssistantCard({ sessionId }: { sessionId?: string | null }) {
  const [dismissed, dismiss] = useDismissed(ASSISTANT_CARD_KEY, sessionId ?? undefined);
  if (dismissed) return null;

  return (
    <div className="px-[14px] pb-3">
      <div
        role="status"
        className="relative rounded-lg p-[14px]"
        style={{ background: "var(--primary-tint)", border: "1px solid var(--primary-tint-strong)" }}
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fechar aviso do assistente"
          className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-md outline-none transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
          style={{ color: "var(--primary-active)" }}
        >
          <X className="size-[14px]" />
        </button>
        <div className="mb-2 flex items-center gap-2 pr-6">
          <Sparkles className="size-[15px]" style={{ color: "var(--primary)" }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--primary-active)" }}>
            Assistente ativo
          </span>
        </div>
        <p
          className="mb-[10px] text-xs leading-[1.45]"
          style={{ color: "var(--primary-active)", opacity: 0.82 }}
        >
          O bot está online e respondendo clientes no canal Web.
        </p>
        <Link
          href="/settings"
          onClick={dismiss}
          className="flex items-center justify-center gap-1 rounded-[var(--radius-sm)] bg-card py-2 text-[12.5px] font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ border: "1px solid var(--primary-tint-strong)" }}
        >
          Configurar
        </Link>
      </div>
    </div>
  );
}
