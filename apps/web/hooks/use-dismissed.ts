"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * "Dispensado" persistido por navegador (localStorage). Serve para avisos que
 * o usuário tem o direito de fechar — não é preferência de conta, então não
 * passa pela API.
 *
 * O `scope` define **por quanto tempo** a dispensa vale: é o valor gravado, e
 * o aviso só conta como dispensado enquanto o scope atual for igual ao
 * gravado. Com o id do login como scope, o aviso volta a cada login novo; com
 * o default fixo, some para sempre naquele navegador.
 *
 * `useSyncExternalStore` em vez de `useState` + `useEffect`: o servidor
 * renderiza "não dispensado" (snapshot do servidor) e o cliente corrige na
 * hidratação sem aviso de mismatch. Toda leitura/escrita é protegida — em
 * navegação privada ou com storage bloqueado, o aviso simplesmente reaparece.
 */

const PREFIX = "dt:dismissed:";
const listeners = new Set<() => void>();

function read(key: string, scope: string): boolean {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) === scope;
  } catch {
    return false;
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

export function useDismissed(
  key: string,
  scope = "1",
): [dismissed: boolean, dismiss: () => void] {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => read(key, scope),
    () => false,
  );

  const dismiss = useCallback(() => {
    try {
      globalThis.localStorage?.setItem(PREFIX + key, scope);
    } catch {
      // Sem storage: o aviso some nesta sessão e volta na próxima. Aceitável.
    }
    listeners.forEach((listener) => listener());
  }, [key, scope]);

  return [dismissed, dismiss];
}
