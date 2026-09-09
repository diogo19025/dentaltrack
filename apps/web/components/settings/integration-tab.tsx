"use client";

import { type ReactNode, useState } from "react";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUSES,
  type AppointmentStatus,
  type ConnectionCheck,
  INTEGRATION_PROVIDER_LABELS,
  type IntegrationMode,
  type IntegrationProvider,
  type IntegrationStatus,
  REQUIRED_STATUS_MAPPINGS,
  type StatusMapping,
} from "@dentaltrack/shared";
import {
  AlertTriangle,
  CalendarDays,
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

const PROVIDER_OPTIONS = [
  { value: "clinicorp" as const, label: "Clinicorp" },
  { value: "google" as const, label: "Google Agenda" },
];

const MODE_OPTIONS = [
  { value: "desligado" as const, label: "Desligada" },
  { value: "mock" as const, label: "Simulada" },
  { value: "live" as const, label: "Real" },
];

const MODE_HELP: Record<IntegrationProvider, Record<IntegrationMode, string>> = {
  clinicorp: {
    desligado:
      "O agente não consulta agenda. Ele coleta a preferência de dia e horário e a equipe confirma — é o comportamento de sempre.",
    mock: "Agenda simulada, para conhecer o fluxo inteiro sem credencial nenhuma. Nada é enviado ao sistema de gestão e os telefones são inválidos de propósito.",
    live: "O agente lê a agenda real, oferece só horários livres e grava o agendamento no sistema de gestão.",
  },
  google: {
    desligado:
      "O agente não consulta agenda. Ele coleta a preferência de dia e horário e a equipe confirma — é o comportamento de sempre.",
    mock: "Agenda simulada, para conhecer o fluxo inteiro sem conectar nada. Nada é enviado ao Google e os telefones são inválidos de propósito.",
    live: "O agente lê a agenda do Google, oferece só horários livres dentro do expediente configurado e grava o agendamento nela.",
  },
};

const PROVIDER_DESCRIPTION: Record<IntegrationProvider, string> = {
  clinicorp:
    "Conectado, o agente passa a oferecer horários que existem de verdade e as automações passam a saber quem faltou e quem compareceu.",
  google:
    "Para a empresa sem sistema de gestão: o agente lê e grava direto na agenda do Google que a equipe já usa.",
};

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const SLOT_OPTIONS = [15, 20, 30, 45, 60];

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
 * Aba "Integração" das Configurações — conecta a agenda da empresa.
 *
 * Dois provedores atrás da mesma porta: **Clinicorp** (F9, sistema de gestão)
 * ou **Google Agenda** (F12, para quem não tem sistema de gestão). Só um fica
 * ativo por vez — duas agendas simultâneas seriam duas fontes de verdade em
 * conflito — e é a empresa que escolhe qual.
 *
 * A tela é o assistente de conexão: guarda a credencial (que nunca volta do
 * servidor), roda a verificação **só-leitura** passo a passo e deixa o operador
 * confirmar o mapeamento de status.
 *
 * Fora do handoff de design; segue o design system existente (produto.md § Design).
 */
export function IntegrationTab() {
  const [choice, setChoice] = useState<IntegrationProvider | null>(null);
  const clinicorp = useIntegration("clinicorp");
  // Abre já no provedor que está ativo — quem usa Google não deve cair no Clinicorp.
  const provider = choice ?? clinicorp.data?.activeProvider ?? "clinicorp";
  const google = useIntegration("google", provider === "google");
  const current = provider === "google" ? google : clinicorp;

  if (clinicorp.isLoading && !clinicorp.data) return <IntegrationSkeleton />;

  return (
    <div className="flex flex-col gap-5">
      <Card className="gap-0 p-0">
        <div className="border-b border-border px-6 py-[18px]">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-[18px] text-muted-foreground" />
            <div className="text-base font-semibold tracking-[-0.01em]">
              De onde vem a agenda
            </div>
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            Escolha o provedor: o sistema de gestão (Clinicorp) ou uma agenda do
            Google. Só um fica ativo por vez.
          </div>
        </div>
        <div className="flex flex-col gap-2 p-6">
          <Segmented
            aria-label="Provedor de agenda"
            options={PROVIDER_OPTIONS}
            value={provider}
            onChange={setChoice}
          />
          {clinicorp.data?.activeProvider && (
            <p className="text-xs text-muted-foreground">
              Ativa hoje:{" "}
              {INTEGRATION_PROVIDER_LABELS[clinicorp.data.activeProvider]}.
            </p>
          )}
        </div>
      </Card>

      {current.isLoading || !current.data ? (
        <Skeleton className="h-64 w-full rounded-[var(--radius)]" />
      ) : (
        <ProviderPanel
          key={provider}
          provider={provider}
          data={current.data}
        />
      )}
    </div>
  );
}

function ProviderPanel({
  provider,
  data,
}: {
  provider: IntegrationProvider;
  data: IntegrationStatus;
}) {
  const update = useUpdateIntegration(provider);
  const check = useCheckIntegration(provider);
  const syncAgenda = useSyncAgenda();

  // A credencial é digitada, então vive em estado local. O resto é **derivado**
  // do servidor: só o que o operador mexeu fica em `edits`. Sem efeito de
  // sincronização, um refetch não apaga o que está sendo preenchido.
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [subscriberId, setSubscriberId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [calendarId, setCalendarId] = useState(data.google?.calendarId ?? "");
  const [workStart, setWorkStart] = useState(data.google?.workStart ?? "08:00");
  const [workEnd, setWorkEnd] = useState(data.google?.workEnd ?? "18:00");
  const [workDays, setWorkDays] = useState<number[]>(
    data.google?.workDays ?? [1, 2, 3, 4, 5],
  );
  const [slotMinutes, setSlotMinutes] = useState(data.google?.slotMinutes ?? 30);
  const [edits, setEdits] = useState<Edits>({});

  const result = check.data;

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

  const toggleWorkDay = (day: number) =>
    setWorkDays((current) =>
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort(),
    );

  function save() {
    const credentials =
      provider === "clinicorp" && mode === "live" && username.trim() && token.trim()
        ? {
            username: username.trim(),
            token: token.trim(),
            subscriberId: subscriberId.trim() || null,
            baseUrl: baseUrl.trim() || null,
          }
        : undefined;
    const googleConfig =
      provider === "google" && calendarId.trim()
        ? {
            calendarId: calendarId.trim(),
            workStart,
            workEnd,
            workDays,
            slotMinutes,
          }
        : undefined;

    update.mutate(
      {
        mode,
        ...(credentials ? { credentials } : {}),
        ...(googleConfig ? { google: googleConfig } : {}),
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

  const missingRequired =
    provider === "clinicorp"
      ? REQUIRED_STATUS_MAPPINGS.filter(
          (status) => !mappings.some((m) => m.status === status),
        )
      : [];
  const otherActive =
    data.activeProvider && data.activeProvider !== provider
      ? INTEGRATION_PROVIDER_LABELS[data.activeProvider]
      : null;

  return (
    <div className="flex flex-col gap-5">
      <Card className="gap-0 p-0">
        <div className="border-b border-border px-6 py-[18px]">
          <div className="flex items-center gap-2">
            <Link2 className="size-[18px] text-muted-foreground" />
            <div className="text-base font-semibold tracking-[-0.01em]">
              {provider === "google"
                ? "Google Agenda"
                : "Sistema de gestão (Clinicorp)"}
            </div>
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {PROVIDER_DESCRIPTION[provider]}
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
            <p className="text-xs text-muted-foreground">
              {MODE_HELP[provider][mode]}
            </p>
          </div>

          {otherActive && mode !== "desligado" && (
            <Note>
              Hoje a agenda ativa é o <strong>{otherActive}</strong>. Salvar com
              este modo ligado <strong>desliga o {otherActive}</strong> — só uma
              agenda pode ser a fonte de verdade.
            </Note>
          )}

          {provider === "clinicorp" && mode === "live" && (
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

          {provider === "google" && mode !== "desligado" && (
            <div className="grid gap-5 md:grid-cols-2">
              {mode === "live" &&
                (data.serviceAccountEmail ? (
                  <Note>
                    Compartilhe a agenda da empresa com{" "}
                    <strong className="break-all">
                      {data.serviceAccountEmail}
                    </strong>{" "}
                    (permissão &quot;Fazer alterações em eventos&quot;), copie o{" "}
                    <strong>ID da agenda</strong> em Configurações da agenda →
                    &quot;Integrar agenda&quot; e cole abaixo.
                  </Note>
                ) : (
                  <div className="flex gap-2 rounded-[var(--radius-sm)] border border-border bg-secondary p-3 text-[13px] md:col-span-2">
                    <AlertTriangle className="mt-0.5 size-4 flex-none text-muted-foreground" />
                    <span>
                      O servidor ainda não tem a conta de serviço do Google
                      configurada (GOOGLE_CALENDAR_SA_EMAIL /
                      GOOGLE_CALENDAR_SA_KEY). Sem ela o modo real não conecta.
                    </span>
                  </div>
                ))}

              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label htmlFor="int-cal">ID da agenda</Label>
                <Input
                  id="int-cal"
                  value={calendarId}
                  placeholder="empresa@gmail.com ou xxxx@group.calendar.google.com"
                  onChange={(e) => setCalendarId(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="int-start">Início do expediente</Label>
                <Input
                  id="int-start"
                  value={workStart}
                  placeholder="08:00"
                  onChange={(e) => setWorkStart(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="int-end">Fim do expediente</Label>
                <Input
                  id="int-end"
                  value={workEnd}
                  placeholder="18:00"
                  onChange={(e) => setWorkEnd(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Dias de atendimento</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_LABELS.map((label, day) => {
                    const active = workDays.includes(day);
                    return (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleWorkDay(day)}
                        className={cn(
                          "rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs font-medium transition-colors",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-secondary",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="int-slot">Duração padrão do horário</Label>
                <Select
                  value={String(slotMinutes)}
                  onValueChange={(v) => setSlotMinutes(Number(v))}
                >
                  <SelectTrigger id="int-slot">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SLOT_OPTIONS.map((minutes) => (
                      <SelectItem key={minutes} value={String(minutes)}>
                        {minutes} minutos
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  É a grade dos horários que o agente oferece.
                </p>
              </div>

              <Note>
                O Google Agenda não registra presença (compareceu/faltou), então
                as automações de remarcação pós-falta e de retorno de manutenção
                não disparam com este provedor. Lembretes de consulta funcionam
                normalmente.
              </Note>
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

      {provider === "clinicorp" &&
        (units.length > 0 || professionals.length > 0) && (
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
