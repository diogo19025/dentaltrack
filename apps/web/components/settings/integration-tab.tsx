"use client";

import { type ReactNode, useState } from "react";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUSES,
  type AppointmentStatus,
  type ConnectionCheck,
  type IntegrationMode,
  REQUIRED_STATUS_MAPPINGS,
  type StatusMapping,
} from "@dentaltrack/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Link2,
  PlugZap,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useSyncAgenda } from "@/hooks/use-agenda";
import {
  useCheckIntegration,
  useIntegration,
  useUpdateIntegration,
} from "@/hooks/use-integration";
import { cn } from "@/lib/utils";

const MODE_OPTIONS = [
  { value: "desligado" as const, label: "Desligada" },
  { value: "mock" as const, label: "Simulada" },
  { value: "live" as const, label: "Real" },
];

const MODE_HELP: Record<IntegrationMode, string> = {
  desligado:
    "O agente não consulta agenda. Ele coleta a preferência de dia e horário e a equipe confirma — é o comportamento de sempre.",
  mock: "Agenda simulada, para conhecer o fluxo inteiro sem credencial nenhuma. Nada é enviado ao sistema de gestão e os telefones são inválidos de propósito.",
  live: "O agente lê a agenda real, oferece só horários livres e grava o agendamento no sistema de gestão.",
};

/** O que o operador mexeu e ainda não salvou. Ausente = usa o do servidor. */
type Edits = {
  mode?: IntegrationMode;
  unitId?: string | null;
  professionalId?: string | null;
  statusMappings?: StatusMapping[];
};

/** Chave "não mapear" do seletor — o Select não aceita valor vazio. */
const IGNORE = "__ignorar__";

/**
 * Aba "Integração" das Configurações (F9) — conecta o sistema de gestão da
 * empresa (Clinicorp).
 *
 * A tela é o assistente de conexão: guarda a credencial (que nunca volta do
 * servidor), roda a verificação **só-leitura** passo a passo e deixa o operador
 * confirmar o mapeamento de status. Nada aqui é fixo no código — unidade,
 * profissional e status vêm da conta do cliente em tempo de execução.
 *
 * Fora do handoff de design; segue o design system existente (plan.md §6).
 */
export function IntegrationTab() {
  const { data, isLoading } = useIntegration();
  const update = useUpdateIntegration();
  const check = useCheckIntegration();
  const syncAgenda = useSyncAgenda();

  // A credencial é digitada, então vive em estado local. O resto é **derivado**
  // do servidor: só o que o operador mexeu fica em `edits`. Sem efeito de
  // sincronização, um refetch não apaga o que está sendo preenchido.
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [subscriberId, setSubscriberId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [edits, setEdits] = useState<Edits>({});

  const result = check.data;

  if (isLoading || !data) return <IntegrationSkeleton />;

  const mode = edits.mode ?? data.mode;
  const unitId = "unitId" in edits ? (edits.unitId ?? null) : data.unitId;
  const professionalId =
    "professionalId" in edits
      ? (edits.professionalId ?? null)
      : data.professionalId;
  // Depois de verificar, a conta devolve as descobertas e o mapeamento sugerido
  // — que é uma sugestão para confirmar, nunca uma decisão já tomada.
  const mappings =
    edits.statusMappings ?? result?.suggestedMappings ?? data.statusMappings;
  const units = result?.units ?? [];
  const professionals = result?.professionals ?? [];

  const setMode = (value: IntegrationMode) =>
    setEdits((current) => ({ ...current, mode: value }));
  const setUnitId = (value: string | null) =>
    setEdits((current) => ({ ...current, unitId: value }));
  const setProfessionalId = (value: string | null) =>
    setEdits((current) => ({ ...current, professionalId: value }));
  const setMappings = (
    updater: (current: StatusMapping[]) => StatusMapping[],
  ) =>
    setEdits((current) => ({
      ...current,
      statusMappings: updater(
        current.statusMappings ??
          result?.suggestedMappings ??
          data.statusMappings,
      ),
    }));

  function save() {
    const credentials =
      mode === "live" && username.trim() && token.trim()
        ? {
            username: username.trim(),
            token: token.trim(),
            subscriberId: subscriberId.trim() || null,
            baseUrl: baseUrl.trim() || null,
          }
        : undefined;

    update.mutate(
      {
        mode,
        ...(credentials ? { credentials } : {}),
        unitId,
        professionalId,
        statusMappings: mappings,
      },
      {
        onSuccess: () => {
          // O token não volta do servidor; limpar o campo evita a impressão de
          // que ele ficou exposto na tela.
          setToken("");
          setEdits({});
        },
      },
    );
  }

  const missingRequired = REQUIRED_STATUS_MAPPINGS.filter(
    (status) => !mappings.some((m) => m.status === status),
  );

  return (
    <div className="flex flex-col gap-5">
      <Card className="gap-0 p-0">
        <div className="border-b border-border px-6 py-[18px]">
          <div className="flex items-center gap-2">
            <Link2 className="size-[18px] text-muted-foreground" />
            <div className="text-base font-semibold tracking-[-0.01em]">
              Sistema de gestão (Clinicorp)
            </div>
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            Conectado, o agente passa a oferecer horários que existem de verdade
            e as automações passam a saber quem faltou e quem compareceu.
          </div>
        </div>

        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-2">
            <Label>Modo</Label>
            <Segmented
              aria-label="Modo da integração"
              options={MODE_OPTIONS}
              value={mode}
              onChange={setMode}
            />
            <p className="text-xs text-muted-foreground">{MODE_HELP[mode]}</p>
          </div>

          {mode === "live" && (
            <div className="grid gap-5 md:grid-cols-2">
              <Note>
                A credencial da API <strong>não é o login do painel</strong>. O
                assinante pede ao suporte do Clinicorp: usuário e token de acesso
                à API REST e o Subscriber ID da conta.
              </Note>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="int-user">Usuário da API</Label>
                <Input
                  id="int-user"
                  value={username}
                  placeholder={data.usernameHint ?? "usuário fornecido pelo suporte"}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="int-token">Token da API</Label>
                <Input
                  id="int-token"
                  type="password"
                  value={token}
                  placeholder={data.hasCredentials ? "•••••••• (já salvo)" : ""}
                  onChange={(e) => setToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Guardado cifrado. Deixe em branco para manter o atual.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="int-sub">Subscriber ID</Label>
                <Input
                  id="int-sub"
                  value={subscriberId}
                  onChange={(e) => setSubscriberId(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="int-url">Endereço da API (opcional)</Label>
                <Input
                  id="int-url"
                  value={baseUrl}
                  placeholder="https://api.clinicorp.com/rest/v1"
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Só para apontar a um ambiente de homologação.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={update.isPending}>
              {update.isPending ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                check.mutate(undefined, {
                  onSuccess: (result) => {
                    // Verificação boa: já traz a agenda para a tela, em vez de
                    // deixar o operador esperando o próximo tique do cron.
                    if (result.ok) syncAgenda.mutate();
                  },
                })
              }
              disabled={check.isPending || mode === "desligado"}
            >
              {check.isPending ? (
                <>
                  <RefreshCw className="size-4 animate-spin" /> Verificando…
                </>
              ) : (
                <>
                  <PlugZap className="size-4" /> Verificar conexão
                </>
              )}
            </Button>
            {data.lastCheckedAt && (
              <span className="text-xs text-muted-foreground">
                Última verificação:{" "}
                {new Date(data.lastCheckedAt).toLocaleString("pt-BR")}
              </span>
            )}
          </div>

          {data.lastError && !result && (
            <div className="flex gap-2 rounded-[var(--radius-sm)] border border-border bg-secondary p-3 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 flex-none text-muted-foreground" />
              <span>Último erro: {data.lastError}</span>
            </div>
          )}
        </div>
      </Card>

      {result && <CheckResult result={result} />}

      {(units.length > 0 || professionals.length > 0) && (
        <Card className="gap-0 p-0">
          <div className="border-b border-border px-6 py-[18px]">
            <div className="text-base font-semibold tracking-[-0.01em]">
              Unidade e profissional
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              Onde o agente busca horários e grava os agendamentos.
            </div>
          </div>
          <div className="grid gap-5 p-6 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-unit">Unidade</Label>
              <Select
                value={unitId ?? IGNORE}
                onValueChange={(v) => setUnitId(v === IGNORE ? null : v)}
              >
                <SelectTrigger id="int-unit">
                  <SelectValue placeholder="Escolha a unidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={IGNORE}>Não definida</SelectItem>
                  {units.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="int-prof">Profissional padrão</Label>
              <Select
                value={professionalId ?? IGNORE}
                onValueChange={(v) =>
                  setProfessionalId(v === IGNORE ? null : v)
                }
              >
                <SelectTrigger id="int-prof">
                  <SelectValue placeholder="Qualquer profissional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={IGNORE}>Qualquer um</SelectItem>
                  {professionals.map((professional) => (
                    <SelectItem key={professional.id} value={professional.id}>
                      {professional.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>
      )}

      {mappings.length > 0 && (
        <Card className="gap-0 p-0">
          <div className="border-b border-border px-6 py-[18px]">
            <div className="text-base font-semibold tracking-[-0.01em]">
              Tradução dos status
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              Cada conta nomeia os seus status. Diga o que cada um significa aqui —
              é isso que decide se uma automação dispara ou não.
            </div>
          </div>

          {missingRequired.length > 0 && (
            <div className="flex gap-2 border-b border-border bg-secondary px-6 py-3 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 flex-none text-muted-foreground" />
              <span>
                Sem um status marcado como{" "}
                <strong>
                  {missingRequired
                    .map((s) => APPOINTMENT_STATUS_LABELS[s])
                    .join(", ")}
                </strong>
                , as automações que dependem dele não vão disparar.
              </span>
            </div>
          )}

          <ul className="divide-y divide-border">
            {mappings.map((mapping, index) => (
              <li
                key={mapping.externalId}
                className="flex items-center gap-4 px-6 py-3"
              >
                <span className="flex-1 text-sm">{mapping.externalName}</span>
                <Select
                  value={mapping.status ?? IGNORE}
                  onValueChange={(value) =>
                    setMappings((current) =>
                      current.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              status:
                                value === IGNORE
                                  ? null
                                  : (value as AppointmentStatus),
                            }
                          : item,
                      ),
                    )
                  }
                >
                  <SelectTrigger
                    className="w-[200px]"
                    aria-label={`Significado de ${mapping.externalName}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={IGNORE}>Ignorar</SelectItem>
                    {APPOINTMENT_STATUSES.filter((s) => s !== "pedido").map(
                      (status) => (
                        <SelectItem key={status} value={status}>
                          {APPOINTMENT_STATUS_LABELS[status]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>

          <div className="border-t border-border px-6 py-4">
            <Button onClick={save} disabled={update.isPending}>
              Salvar tradução
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** O passo a passo da verificação — o que respondeu e o que divergiu. */
function CheckResult({ result }: { result: ConnectionCheck }) {
  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center gap-2 border-b border-border px-6 py-[18px]">
        {result.ok ? (
          <CheckCircle2 className="size-[18px] text-primary" />
        ) : (
          <XCircle className="size-[18px] text-muted-foreground" />
        )}
        <div className="text-base font-semibold tracking-[-0.01em]">
          {result.ok ? "Conexão verificada" : "A verificação parou"}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {result.steps.map((step) => (
          <li key={step.key} className="flex items-start gap-3 px-6 py-3">
            {step.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 flex-none text-primary" />
            ) : (
              <XCircle className="mt-0.5 size-4 flex-none text-muted-foreground" />
            )}
            <div className="flex-1">
              <div className="text-sm font-medium">{step.label}</div>
              <div
                className={cn(
                  "mt-0.5 text-[13px]",
                  step.ok ? "text-muted-foreground" : "text-secondary-foreground",
                )}
              >
                {step.detail}
              </div>
            </div>
            <span className="tabular text-xs text-muted-foreground">
              {step.durationMs} ms
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-[var(--radius-sm)] border border-border bg-secondary p-3 text-[13px] md:col-span-2">
      <Info className="mt-0.5 size-4 flex-none text-muted-foreground" />
      <span className="text-secondary-foreground">{children}</span>
    </div>
  );
}

function IntegrationSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-64 w-full rounded-[var(--radius)]" />
      <Skeleton className="h-40 w-full rounded-[var(--radius)]" />
    </div>
  );
}
