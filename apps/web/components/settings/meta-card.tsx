"use client";

import { useState } from "react";
import { saveMetaCredentialsSchema } from "@dentaltrack/shared";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useMetaConnection,
  useRemoveMetaCredentials,
  useSaveMetaCredentials,
} from "@/hooks/use-meta-connection";
import { errorMessage } from "@/lib/api-client";

/**
 * Cartão "API oficial da Meta" da aba WhatsApp. A empresa cola o ID do número,
 * o ID da conta e o token que tirou do painel da Meta. O token é validado e
 * guardado cifrado; depois de salvo, a tela só mostra que existe um. Salvar
 * troca o provedor da empresa para a Meta; remover volta para a Evolution.
 *
 * Fora do handoff de design; segue o design system existente.
 */
export function MetaCard() {
  const { data, isLoading, isError, error, refetch } = useMetaConnection();
  const save = useSaveMetaCredentials();
  const remove = useRemoveMetaCredentials();
  const [form, setForm] = useState({
    phoneNumberId: "",
    wabaId: "",
    accessToken: "",
  });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isError && !data) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  if (isLoading || !data) {
    return <Skeleton className="h-56 w-full rounded-[var(--radius)]" />;
  }

  const active = data.provider === "meta";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = saveMetaCredentialsSchema.safeParse(form);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Confira os campos.");
      return;
    }
    setFieldError(null);
    save.mutate(parsed.data, {
      onSuccess: () =>
        setForm({ phoneNumberId: "", wabaId: "", accessToken: "" }),
    });
  };

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-[18px]">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 size-[18px] text-muted-foreground" />
          <div>
            <div className="text-base font-semibold tracking-[-0.01em]">
              API oficial da Meta
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              Usa a Cloud API oficial em vez do QR code. Ao salvar, o assistente
              e os avisos passam a sair por ela.
            </div>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[5px] text-[12px] font-medium ${active ? "status-agendada" : "status-em_andamento"}`}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {active ? "Em uso" : "Desligada"}
        </span>
      </div>

      <div className="flex flex-col gap-4 p-6">
        {!data.serverReady && (
          <div className="flex gap-2 rounded-[var(--radius-sm)] border border-border bg-secondary p-3 text-[13px]">
            <AlertTriangle className="mt-0.5 size-4 flex-none text-muted-foreground" />
            <span className="text-secondary-foreground">
              O servidor ainda não está habilitado para a Meta. Peça a quem
              cuida da infraestrutura para configurar o segredo do app, o token
              de verificação e a chave de cifra (ver{" "}
              <code>docs/operacao.md</code>).
            </span>
          </div>
        )}

        {active && (
          <p className="text-[13px] text-muted-foreground">
            Conectado a{" "}
            <strong className="text-foreground">
              {data.verifiedName ?? "número da Meta"}
            </strong>
            {data.displayPhone ? ` (${data.displayPhone})` : ""}. Token salvo e
            cifrado.
          </p>
        )}

        {data.webhookUrl && (
          <p className="text-[13px] text-muted-foreground">
            No app da Meta, cadastre o webhook em{" "}
            <code className="tabular">{data.webhookUrl}</code> e assine o campo{" "}
            <code>messages</code>.
          </p>
        )}

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-phone-id">ID do número</Label>
            <Input
              id="meta-phone-id"
              inputMode="numeric"
              value={form.phoneNumberId}
              onChange={(e) =>
                setForm({ ...form, phoneNumberId: e.target.value })
              }
              placeholder={data.phoneNumberId ?? "ex.: 105512345678901"}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meta-waba-id">ID da conta WhatsApp Business</Label>
            <Input
              id="meta-waba-id"
              inputMode="numeric"
              value={form.wabaId}
              onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
              placeholder={data.wabaId ?? "ex.: 207712345678901"}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="meta-token">Token de acesso permanente</Label>
            <Input
              id="meta-token"
              type="password"
              autoComplete="off"
              value={form.accessToken}
              onChange={(e) =>
                setForm({ ...form, accessToken: e.target.value })
              }
              placeholder={
                data.tokenSaved ? "Token salvo — cole outro para trocar" : ""
              }
            />
          </div>

          {(fieldError || save.isError) && (
            <p
              role="alert"
              className="text-[13px] text-destructive sm:col-span-2"
            >
              {fieldError ?? errorMessage(save.error)}
            </p>
          )}

          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button
              type="submit"
              disabled={save.isPending || !data.serverReady}
            >
              {save.isPending
                ? "Validando na Meta…"
                : active
                  ? "Atualizar credenciais"
                  : "Validar e usar a API oficial"}
            </Button>
            {(active || data.tokenSaved) && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmOpen(true)}
              >
                Remover e voltar ao QR code
              </Button>
            )}
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remover a API oficial da Meta?"
        description="O token salvo é apagado e a empresa volta a usar o número pareado por QR code (se houver um conectado)."
        confirmLabel="Remover"
        destructive
        isPending={remove.isPending}
        error={remove.isError ? remove.error : undefined}
        onConfirm={() =>
          remove.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })
        }
      />
    </Card>
  );
}
