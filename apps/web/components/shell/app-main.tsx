"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Área de conteúdo do shell (F0.6). Replica o condicional `isChat` do design
 * (`app.jsx`): o chat ocupa 100% da altura com `overflow:hidden` e padding 20px;
 * as demais telas usam `max-width 1240px` + padding 28/32px e rolam.
 * O `key={pathname}` re-dispara a transição `fadeUp` ao trocar de rota.
 *
 * Publica em `<html data-scrolled>` se o conteúdo já rolou: a topbar usa isso
 * para mostrar a borda inferior só quando há conteúdo passando por baixo do
 * material (scroll edge), em vez de uma divisória fixa.
 */
export function AppMain({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isChat = pathname === "/chat" || pathname.startsWith("/chat/");
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      root.toggleAttribute("data-scrolled", el.scrollTop > 2);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      root.removeAttribute("data-scrolled");
    };
  }, [pathname]);

  return (
    <main
      ref={mainRef}
      className={cn(
        "min-h-0 flex-1",
        isChat ? "overflow-hidden" : "overflow-auto",
      )}
    >
      <div
        key={pathname}
        className={cn(
          "anim-fade-up box-border",
          isChat
            ? "h-full p-5"
            : "mx-auto w-full max-w-[1240px] px-8 pb-10 pt-7",
        )}
      >
        {children}
      </div>
    </main>
  );
}
