"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { Role } from "@dentaltrack/shared";

/**
 * Papel do usuário na empresa, com **três** estados — e o terceiro é o que
 * faltava.
 *
 * Até 2026-09-11 havia só dois: o layout começava com `staff` e promovia a
 * `owner` se o bootstrap respondesse. "Não sei" e "é atendente" eram a mesma
 * coisa, então qualquer instabilidade — cold start do Railway, deploy em
 * andamento, API de uma versão que ainda não devolvia o papel — **rebaixava o
 * dono e escondia dele o produto inteiro**, sem dizer por quê.
 *
 * O `null` separa os dois casos, e a regra para ele é deliberadamente
 * **otimista**: mostrar o controle. A barreira de verdade é o `RolesGuard` da
 * API, que recusa com 403 independentemente do que a tela exibiu. O custo de
 * errar para cada lado não é simétrico:
 *
 * - otimista com um atendente → ele vê um botão que a API recusa;
 * - pessimista com o dono → ele perde o acesso às Configurações sem explicação,
 *   exatamente quando a plataforma já está instável.
 *
 * **Fora de um provider o padrão continua sendo `staff`**: ali não há shell
 * autenticado, ninguém está sendo bloqueado e o conservador é o certo.
 */
type RoleContextValue = {
  /** `null` quando o bootstrap não respondeu. */
  role: Role | null;
  /** `false` só no caso acima — a tela usa isto para avisar, não para decidir. */
  known: boolean;
};

const RoleContext = createContext<RoleContextValue>({
  role: "staff",
  known: true,
});

export function RoleProvider({
  role,
  children,
}: {
  role: Role | null;
  children: ReactNode;
}) {
  return (
    <RoleContext.Provider value={{ role, known: role !== null }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const { role, known } = useContext(RoleContext);
  return {
    role,
    roleKnown: known,
    /** Otimista quando o papel é desconhecido — ver o cabeçalho do módulo. */
    isOwner: role === "owner" || !known,
  };
}

/** Esconde controles administrativos; a API segue sendo a barreira de segurança. */
export function OwnerOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { isOwner } = useRole();
  return isOwner ? children : fallback;
}
