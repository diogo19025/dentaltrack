"use client";

import { WHATSAPP_STATE_LABELS, type WhatsappLine } from "@dentaltrack/shared";
import { MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { WhatsappConnectPanel } from "@/components/whatsapp/connect-panel";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import { cn } from "@/lib/utils";

/**
 * Aba "WhatsApp" das Configurações (F10) — conectar, reconectar ou trocar o
 * número da empresa.
 *
 * É o mesmo painel do primeiro acesso, aqui em caráter permanente: a sessão do
 * WhatsApp cai de vez em quando (celular offline, aparelho removido na mão), e
 * reconectar precisa ser algo que o dono resolve sozinho — não um chamado.
 *
 * Fora do handoff de design; segue o design system existente (produto.md § Design).
 */
export function WhatsappTab() {
  return (
    <div className="flex flex-col gap-6">
      <LineCard
        line="principal"
        title="Número principal"
        description="O assistente atende neste número com a mesma configuração do chat."
      />
      <LineCard
        line="avisos"
        title="Número de avisos"
        description="Opcional. Só envia lembretes e mensagens automáticas de eventos. Sem ele, esses avisos saem pelo número principal."
      />
    </div>
  );
}

function LineCard({
  line,
  title,
  description,
}: {
  line: WhatsappLine;
  title: string;
  description: string;
}) {
  const {
    data: connection,
    isLoading,
    isError,
    error,
    refetch,
  } = useWhatsappConnection(true, line);

  if (isError && !connection) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  if (isLoading || !connection) {
    return <Skeleton className="h-72 w-full rounded-[var(--radius)]" />;
  }

  // Sem Evolution no servidor o cartão principal já explica; repetir no de
  // avisos só duplicaria o aviso.
  if (line === "avisos" && !connection.serverReady) return null;

  const connected = connection.state === "conectado";

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-[18px]">
        <div className="flex gap-3">
          <MessageCircle className="mt-0.5 size-[18px] text-muted-foreground" />
          <div>
            <div className="text-base font-semibold tracking-[-0.01em]">
              {title}
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {description}
            </div>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[5px] text-[12px] font-medium",
            connected ? "status-agendada" : "status-em_andamento",
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {WHATSAPP_STATE_LABELS[connection.state]}
        </span>
      </div>

      <div className="p-6">
        <WhatsappConnectPanel connection={connection} line={line} />
      </div>

      {connection.instanceName && (
        <div className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
          Instância: <span className="tabular">{connection.instanceName}</span>
        </div>
      )}
    </Card>
  );
}
