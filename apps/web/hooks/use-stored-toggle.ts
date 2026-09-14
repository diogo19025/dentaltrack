"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Booleano persistido por navegador (localStorage), com um fallback para
 * quando nada foi gravado. Serve para preferências de tela que o usuário tem
 * o direito de mudar — expandido/recolhido, por exemplo — e que não são
 * configuração de conta, então não passam pela API.
 *
 * Mesmo desenho do `useDismissed`: `useSyncExternalStore` para o servidor
 * renderizar o fallback e o cliente corrigir na hidratação sem mismatch; toda
 * leitura/escrita protegida — com storage bloqueado, o valor vive só em
 * memória e dura a sessão da página.
 */

const PREFIX = "dt:toggle:";
const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();

function read(key: string): boolean | null {
  try {
    const raw = globalThis.localStorage.getItem(PREFIX + key);
    return raw === "1" ? true : raw === "0" ? false : null;
  } catch {
    // Storage bloqueado: só aí a memória responde.
    return memory.get(key) ?? null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  globalThis.addEventListener?.("storage", listener);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", listener);
  };
}

export function useStoredToggle(
  key: string,
  fallback: boolean,
): [value: boolean, setValue: (next: boolean) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );

  const setValue = useCallback(
    (next: boolean) => {
      try {
        globalThis.localStorage.setItem(PREFIX + key, next ? "1" : "0");
      } catch {
        // Sem storage: vale a memória até recarregar.
        memory.set(key, next);
      }
      listeners.forEach((listener) => listener());
    },
    [key],
  );

  return [stored ?? fallback, setValue];
}
