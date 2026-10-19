"use client";

import { useState } from "react";
import {
  WHATSAPP_PROVIDER_LABELS,
  WHATSAPP_PROVIDERS,
  type WhatsappProvider,
} from "@dentaltrack/shared";
import { Route } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useMetaConnection,
  useSetWhatsappProvider,
} from "@/hooks/use-meta-connection";
import { errorMessage } from "@/lib/api-client";

const OPTIONS = WHATSAPP_PROVIDERS.map((value) => ({
  value,
  label: WHATSAPP_PROVIDER_LABELS[value],
}));

/**
 * Cartão "Provedor ativo" da aba WhatsApp. O número pareado por QR code e a
 * API oficial da Meta ficam configurados lado a lado; aqui o dono escolhe qual
 * dos dois atende o cliente e envia os avisos. Trocar não apaga nada.
 *
 * Fora do handoff de design; segue o design system existente.
 */
export function WhatsappProviderCard() {
  const { data, isLoading, isError, error, refetch } = useMetaConnection();
  const setProvider = useSetWhatsappProvider();
  const [hint, setHint] = useState<string | null>(null);

  if (isError && !data) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  if (isLoading || !data) {
    return <Skeleton className="h-28 w-full rounded-[var(--radius)]" />;
  }

  function choose(provider: WhatsappProvider) {
    if (provider === data!.provider) return;
    if (provider === "meta" && !data!.tokenSaved) {
      setHint(
        "Salve as credenciais no cartão “API oficial da Meta” abaixo antes de ativá-la.",
      );
      return;
    }
    setHint(null);
    setProvider.mutate(provider);
  }

  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-[18px]">
        <div className="flex gap-3">
          <Route className="mt-0.5 size-[18px] text-muted-foreground" />
          <div>
            <div className="text-base font-semibold tracking-[-0.01em]">
              Provedor ativo
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              Por onde o assistente atende e os avisos saem. As duas
              configurações continuam guardadas ao trocar.
            </div>
          </div>
        </div>
        <Segmented
          aria-label="Provedor do WhatsApp"
          options={OPTIONS}
          value={data.provider}
          onChange={choose}
        />
      </div>
      {(hint || setProvider.isError) && (
        <p
          role="alert"
          className="border-t border-border px-6 py-3 text-[13px] text-destructive"
        >
          {hint ?? errorMessage(setProvider.error)}
        </p>
      )}
    </Card>
  );
}
