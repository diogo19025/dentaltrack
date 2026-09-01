"use client";

import { useEffect, useState } from "react";
import type { WhatsappConnection } from "@dentaltrack/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useConnectWhatsapp,
  useDisconnectWhatsapp,
  useResetWhatsapp,
} from "@/hooks/use-whatsapp-connection";
import { cn } from "@/lib/utils";

/**
 * Vida útil do QR na tela. O código do WhatsApp dura cerca de 1 minuto, então
 * renovamos aos 40s — com margem para o dono levantar, pegar o celular e
 * apontar a câmera sem o código morrer no meio do caminho.
 */
const QR_LIFETIME_MS = 40_000;

/**
 * Painel de conexão do WhatsApp (F10) — o pareamento por QR.
 *
 * Usado em dois lugares com o mesmo comportamento: no passo do primeiro acesso
 * e na aba WhatsApp das Configurações. O QR se renova sozinho enquanto a tela
 * estiver aberta, e a lista de estados vira sozinha para "conectado" assim que
 * o celular lê o código — o dono não precisa recarregar nada.
 */
export function WhatsappConnectPanel({
  connection,
  onConnected,
  compact = false,
}: {
  connection: WhatsappConnection;
  onConnected?: () => void;
  compact?: boolean;
}) {
  const connect = useConnectWhatsapp();
  const disconnect = useDisconnectWhatsapp();
  const reset = useResetWhatsapp();

  const qrCode = connect.data?.qrCode ?? connection.qrCode;

  // Enquanto houver um QR recém-gerado, a tela segue em modo de pareamento
  // mesmo que a consulta de estado oscile. A Evolution reporta `close` no
  // intervalo entre gerar o código e alguém lê-lo, e sumir com o QR bem nesse
  // momento seria o pior desfecho possível.
  const waiting =
    connection.state !== "conectado" &&
    (connection.state === "aguardando_leitura" ||
      Boolean(connect.data?.qrCode));

  // Relógio de 1 em 1 segundo, só para a contagem regressiva do QR.
  const [now, setNow] = useState(() => Date.now());
  const issuedAt = connect.submittedAt || null;
  const secondsLeft =
    waiting && qrCode && issuedAt
      ? Math.max(0, Math.ceil((issuedAt + QR_LIFETIME_MS - now) / 1000))
      : null;
  const expired = secondsLeft === 0;

  // O QR morre em cerca de um minuto. Enquanto o pareamento estiver pendente e
  // a tela aberta, pedimos um código novo antes disso — ler um QR vencido e
  // concluir que "não funciona" era o desfecho fácil.
  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    const renew = setInterval(() => connect.mutate(), QR_LIFETIME_MS);
    return () => {
      clearInterval(tick);
      clearInterval(renew);
    };
    // `connect` é estável o suficiente para o efeito; só o estado importa aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  // Avisa o consumidor (o diálogo do primeiro acesso fecha sozinho).
  useEffect(() => {
    if (connection.state === "conectado") onConnected?.();
  }, [connection.state, onConnected]);

  if (!connection.serverReady) {
    return (
      <Notice tone="warning">
        O WhatsApp ainda não está habilitado neste servidor. Peça a quem cuida da
        infraestrutura para configurar a Evolution API e a URL pública da API
        (ver <code>docs/WHATSAPP.md</code>).
      </Notice>
    );
  }

  if (connection.state === "conectado") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-border bg-primary-tint px-4 py-3">
          <CheckCircle2 className="size-5 flex-none" style={{ color: "var(--primary)" }} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-primary">
              Número conectado
            </div>
            {connection.phone && (
              <div className="tabular text-[13px] text-primary">
                {formatPhone(connection.phone)}
              </div>
            )}
          </div>
        </div>
        <p className="text-[13px] text-muted-foreground">
          O assistente já responde a quem escrever para este número. As conversas
          aparecem no painel com o canal <strong>WhatsApp</strong>.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
          >
            {disconnect.isPending ? "Desconectando…" : "Desconectar"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (
                confirm(
                  "Isso remove a conexão atual para você parear outro número. Continuar?",
                )
              ) {
                reset.mutate();
              }
            }}
            disabled={reset.isPending}
          >
            Trocar de número
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!compact && (
        <Notice tone="info">
          Use um <strong>número dedicado</strong>, não o seu pessoal: quem ler
          este QR passa a ser atendido pelo assistente automaticamente.
        </Notice>
      )}

      {waiting && qrCode ? (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="rounded-[var(--radius)] border border-border bg-card p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URI vindo da API, sem otimização possível */}
            <img
              src={qrCode}
              alt="QR code para conectar o WhatsApp"
              width={220}
              height={220}
              className="size-[220px]"
            />
          </div>
          <ol className="flex-1 space-y-2 text-[13.5px] leading-[1.5]">
            <Step n={1}>
              No celular do número dedicado, abra o <strong>WhatsApp</strong>.
            </Step>
            <Step n={2}>
              Toque em <strong>Aparelhos conectados</strong> →{" "}
              <strong>Conectar um aparelho</strong>.
            </Step>
            <Step n={3}>Aponte a câmera para este QR code.</Step>
            <li className="flex items-center gap-2 pt-1 text-muted-foreground">
              {expired ? (
                <>
                  <RefreshCw className="size-3.5 animate-spin" />
                  Código expirado — gerando um novo…
                </>
              ) : (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>
                    Esperando a leitura
                    {secondsLeft !== null && (
                      <>
                        {" · expira em "}
                        <span className="tabular font-medium text-foreground">
                          {formatSeconds(secondsLeft)}
                        </span>
                      </>
                    )}
                  </span>
                </>
              )}
            </li>
            {connection.pairingCode && (
              <li className="pt-2 text-muted-foreground">
                Sem câmera? Use o código{" "}
                <strong className="tabular">{connection.pairingCode}</strong> em
                “Conectar com número de telefone”.
              </li>
            )}
          </ol>
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col items-center gap-3 rounded-[var(--radius-sm)] border border-dashed border-border px-6 text-center",
            compact ? "py-6" : "py-10",
          )}
        >
          <QrCode className="size-6 text-muted-foreground" />
          <p className="max-w-[380px] text-[13px] text-muted-foreground">
            {connection.state === "desconectado"
              ? "A sessão caiu — pode acontecer se o celular ficar muito tempo offline. Gere um QR novo para reconectar."
              : "Gere o QR code e leia com o celular do número dedicado para conectar o assistente."}
          </p>
          <Button
            type="button"
            onClick={() => connect.mutate()}
            disabled={connect.isPending}
          >
            {connect.isPending ? (
              <>
                <RefreshCw className="size-4 animate-spin" /> Gerando…
              </>
            ) : (
              <>
                <Smartphone className="size-4" />
                {connection.state === "desconectado"
                  ? "Reconectar"
                  : "Gerar QR code"}
              </>
            )}
          </Button>
        </div>
      )}

      {waiting && (
        <div className="flex justify-center">
          <Button
            type="button"
            // Vencido, o botão deixa de ser secundário: nesse momento ele é a
            // única coisa que o dono precisa ver.
            variant={expired ? "default" : "ghost"}
            size="sm"
            onClick={() => connect.mutate()}
            disabled={connect.isPending}
          >
            <RefreshCw className={cn("size-4", connect.isPending && "animate-spin")} />
            {expired ? "Gerar novo QR code" : "Gerar outro código"}
          </Button>
        </div>
      )}

      {(connect.isError || connection.lastError) && (
        <Notice tone="warning">
          {connect.error instanceof Error
            ? connect.error.message
            : (connection.lastError ??
              "Não foi possível preparar a conexão agora.")}
        </Notice>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="tabular mt-px flex size-5 flex-none items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warning";
  children: React.ReactNode;
}) {
  const Icon = tone === "warning" ? AlertTriangle : Info;
  return (
    <div className="flex gap-2 rounded-[var(--radius-sm)] border border-border bg-secondary p-3 text-[13px]">
      <Icon className="mt-0.5 size-4 flex-none text-muted-foreground" />
      <span className="text-secondary-foreground">{children}</span>
    </div>
  );
}

/** Segundos restantes → "0:38". */
function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** "5511999998888" → "+55 (11) 99999-8888". Só exibição. */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const match = /^(\d{2})(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  if (!match) return raw;
  return `+${match[1]} (${match[2]}) ${match[3]}-${match[4]}`;
}
