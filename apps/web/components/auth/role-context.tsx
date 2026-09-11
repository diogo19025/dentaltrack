"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { Role } from "@dentaltrack/shared";

const RoleContext = createContext<Role>("staff");

export function RoleProvider({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const role = useContext(RoleContext);
  return { role, isOwner: role === "owner" };
}

/** Esconde controles administrativos; a API segue sendo a barreira de segurança. */
export function OwnerOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useContext(RoleContext) === "owner" ? children : fallback;
}
