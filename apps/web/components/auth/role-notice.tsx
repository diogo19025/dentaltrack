"use client";

import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRole } from "./role-context";

/**
 * Aviso de que o papel do usuário não pôde ser confirmado.
 *
 * Existe porque a falha que o produziu era **silenciosa**: o layout logava a
 * falha do bootstrap num `console.error` do servidor, que ninguém lê, e a tela
 * seguia como se soubesse quem era o usuário. Uma decisão de permissão tomada
 * sem informação precisa aparecer para quem vai sentir o efeito dela.
 *
 * O recarregar é `router.refresh()`: o papel é resolvido no servidor, então o
 * que precisa acontecer de novo é o render do layout, não um F5 da aba.
 */
export function RoleNotice() {
  const { roleKnown } = useRole();
  const router = useRouter();
  if (roleKnown) return null;

  return (
    <div
      role="status"
      className="flex min-h-9 flex-wrap items-center justify-center gap-2 border-b border-border px-4 py-2 text-center text-[12.5px] text-muted-foreground"
      style={{ background: "var(--secondary)" }}
    >
      <ShieldAlert className="size-4 shrink-0" />
      <span>
        Não foi possível confirmar suas permissões — algumas ações podem ser
        recusadas.
      </span>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="font-semibold underline underline-offset-2"
      >
        Tentar novamente
      </button>
    </div>
  );
}
