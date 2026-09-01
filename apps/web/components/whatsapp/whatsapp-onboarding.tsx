"use client";

import { useState } from "react";
import { MessageCircle, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WhatsappConnectPanel } from "@/components/whatsapp/connect-panel";
import {
  useAnswerWhatsappOnboarding,
  useWhatsappConnection,
} from "@/hooks/use-whatsapp-connection";

type Step = "pergunta" | "parear";

/**
 * Primeiro acesso: a pergunta do WhatsApp (F10).
 *
 * Aparece uma vez, quando a empresa ainda não respondeu se tem um número
 * dedicado. Perguntar **antes** de mostrar o QR não é cerimônia: o número que
 * ler aquele código passa a ser operado pelo bot, respondendo sozinho a quem
 * escrever. Num número pessoal isso é um problema sério — e quem ainda não tem
 * um número separado precisa saber disso antes, não depois.
 *
 * Quem responde "ainda não" não é perguntado de novo: a resposta fica guardada
 * na empresa, e o pareamento continua disponível nas Configurações.
 */
export function WhatsappOnboarding() {
  const { data: connection } = useWhatsappConnection();
  const answer = useAnswerWhatsappOnboarding();
  const [step, setStep] = useState<Step | null>(null);
  const [closed, setClosed] = useState(false);

  // Derivado do servidor, sem efeito de sincronização: a caixa aparece enquanto
  // a pergunta não foi respondida e o servidor suporta o pareamento.
  const shouldAsk = Boolean(
    connection && !connection.onboardingAnswered && connection.serverReady,
  );
  const active: Step | null = step ?? (shouldAsk && !closed ? "pergunta" : null);

  function close() {
    setStep(null);
    setClosed(true);
  }

  if (!connection || active === null) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-[560px]">
        {active === "pergunta" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageCircle className="size-[18px]" style={{ color: "var(--primary)" }} />
                Conectar o WhatsApp do atendimento
              </DialogTitle>
              <DialogDescription>
                O assistente pode atender pelo WhatsApp com a mesma configuração
                do chat. Para isso, ele precisa de um número só dele.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-[var(--radius-sm)] border border-border bg-secondary p-4 text-[13px] leading-[1.55] text-secondary-foreground">
              <strong>Você já tem um número dedicado para o atendimento?</strong>
              <p className="mt-1.5">
                Precisa ser um número separado — um chip só para a empresa, com o
                WhatsApp instalado num celular. Quem escrever para ele será
                respondido automaticamente pelo assistente, então não use o seu
                número pessoal.
              </p>
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  answer.mutate("nao_tem");
                  close();
                }}
                disabled={answer.isPending}
              >
                Ainda não tenho
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setStep("parear");
                  answer.mutate("tem_numero");
                }}
                disabled={answer.isPending}
              >
                <Smartphone className="size-4" />
                {answer.isPending ? "Preparando…" : "Sim, quero conectar"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Conectar o número</DialogTitle>
              <DialogDescription>
                Leia o QR code com o celular do número dedicado.
              </DialogDescription>
            </DialogHeader>

            <WhatsappConnectPanel connection={connection} compact />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                {connection.state === "conectado" ? "Concluir" : "Fazer isso depois"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
