"use client";

import { type ReactNode, useState } from "react";
import {
  AUTOMATION_LABELS,
  type AutomationSettings,
  TEMPLATE_PLACEHOLDERS,
  renderTemplate,
} from "@dentaltrack/shared";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  CalendarPlus,
  Check,
  Clock,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useAutomations,
  useCreateHoliday,
  useDeleteHoliday,
  useHolidays,
  useSyncHolidays,
  useUpdateAutomations,
} from "@/hooks/use-automations";
import { cn } from "@/lib/utils";

/**
 * Aba "Automações" das Configurações (F9). Reúne num lugar só o que a empresa
 * envia sem ninguém apertar botão: lembretes, aviso de atraso, remarcação após
 * falta e retorno de manutenção — mais a higiene de envio (janela, feriados,
 * teto diário) que vale para todos.
 *
 * Fora do handoff de design; segue o design system existente (produto.md § Design).
 */
export function AutomationsTab() {
  const { data, isLoading, isError, error, refetch } = useAutomations();
  const update = useUpdateAutomations();
  // Só as edições pendentes ficam em estado; o resto vem do servidor. Derivar
  // em vez de sincronizar num efeito evita o refetch apagar o que está sendo
  // digitado — e dispensa o efeito por completo.
  const [edits, setEdits] = useState<AutomationSettings | null>(null);

  if (isError && !data) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  if (isLoading || !data) return <AutomationsSkeleton />;

  const current = edits ?? data;
  const dirty = edits !== null && JSON.stringify(edits) !== JSON.stringify(data);
  const patch = (values: Partial<AutomationSettings>) =>
    setEdits({ ...current, ...values });

  function save() {
    // Salvo, o rascunho é descartado e a tela volta a espelhar o servidor.
    update.mutate(current, { onSuccess: () => setEdits(null) });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="gap-0 p-0">
        <SectionHeader
          title="Como e quando enviar"
          desc="Vale para todas as automações. O canal é um WhatsApp comum: disparo fora de hora ou em rajada põe o número da empresa em risco."
        />
        <div className="grid gap-5 p-6 md:grid-cols-2">
          <Field label="Fuso horário" htmlFor="tz">
            <Input
              id="tz"
              value={current.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
            />
            <Hint>Ancora os horários. Ex.: America/Sao_Paulo.</Hint>
          </Field>

          <Field label="Teto de mensagens por dia" htmlFor="cap">
            <Input
              id="cap"
              type="number"
              min={1}
              max={2000}
              value={current.dailyCap}
              onChange={(e) =>
                patch({ dailyCap: Number(e.target.value) || 1 })
              }
            />
            <Hint>Atingido o teto, o restante do dia é adiado.</Hint>
          </Field>

          <Field label="Enviar a partir de" htmlFor="from">
            <Input
              id="from"
              type="time"
              value={current.sendWindowStart}
              onChange={(e) => patch({ sendWindowStart: e.target.value })}
            />
          </Field>

          <Field label="Enviar até" htmlFor="to">
            <Input
              id="to"
              type="time"
              value={current.sendWindowEnd}
              onChange={(e) => patch({ sendWindowEnd: e.target.value })}
            />
          </Field>

          <ToggleRow
            label="Não enviar em feriados"
            desc="Disparos que caírem em feriado são adiados para o próximo dia útil."
            checked={current.skipHolidays}
            onChange={(skipHolidays) => patch({ skipHolidays })}
          />
          <ToggleRow
            label="Não enviar em fins de semana"
            desc="Útil para clínicas que só atendem em dias úteis."
            checked={current.skipWeekends}
            onChange={(skipWeekends) => patch({ skipWeekends })}
          />
        </div>
      </Card>

      <RuleCard
        icon={<BellRing className="size-[18px]" />}
        title={AUTOMATION_LABELS.lembrete_3d}
        desc="Confirma com folga suficiente para a agenda ser reaproveitada se o cliente desmarcar."
        rule={current.lembrete3d}
        onChange={(lembrete3d) => patch({ lembrete3d })}
      />
      <RuleCard
        icon={<BellRing className="size-[18px]" />}
        title={AUTOMATION_LABELS.lembrete_1d}
        desc="O lembrete que mais reduz falta."
        rule={current.lembrete1d}
        onChange={(lembrete1d) => patch({ lembrete1d })}
      />
      <RuleCard
        icon={<Clock className="size-[18px]" />}
        title={AUTOMATION_LABELS.lembrete_1h}
        desc="O empurrãozinho final. Se cair fora da janela de envio, é descartado em vez de enviado atrasado."
        rule={current.lembrete1h}
        onChange={(lembrete1h) => patch({ lembrete1h })}
      />

      <RuleCard
        icon={<AlertTriangle className="size-[18px]" />}
        title={AUTOMATION_LABELS.atraso}
        desc="Só funciona se a recepção marcar a chegada do cliente no sistema de gestão em tempo real."
        warning="Sem esse hábito na recepção, a mensagem chega para quem já está na sala de espera. Deixe desligado até ter certeza."
        rule={current.atraso}
        onChange={(atraso) => patch({ atraso })}
        extra={
          <Field label="Tolerância (minutos)" htmlFor="tolerance">
            <Input
              id="tolerance"
              type="number"
              min={5}
              max={120}
              value={current.atraso.toleranceMinutes}
              onChange={(e) =>
                patch({
                  atraso: {
                    ...current.atraso,
                    toleranceMinutes: Number(e.target.value) || 15,
                  },
                })
              }
            />
          </Field>
        }
      />

      <RuleCard
        icon={<UserX className="size-[18px]" />}
        title={AUTOMATION_LABELS.falta}
        desc="Tenta remarcar quem não apareceu. A sequência para assim que o cliente responder."
        rule={current.falta}
        onChange={(falta) => patch({ falta })}
        extra={
          <>
            <Field label="Tentativas (máx. 3)" htmlFor="attempts">
              <Input
                id="attempts"
                type="number"
                min={1}
                max={3}
                value={current.falta.attempts}
                onChange={(e) =>
                  patch({
                    falta: {
                      ...current.falta,
                      attempts: Math.min(Number(e.target.value) || 1, 3),
                    },
                  })
                }
              />
              <Hint>Insistir além disso vira spam e arrisca o número.</Hint>
            </Field>
            <Field label="Intervalo entre tentativas (horas)" htmlFor="interval">
              <Input
                id="interval"
                type="number"
                min={1}
                max={168}
                value={current.falta.intervalHours}
                onChange={(e) =>
                  patch({
                    falta: {
                      ...current.falta,
                      intervalHours: Number(e.target.value) || 48,
                    },
                  })
                }
              />
            </Field>
          </>
        }
      />

      <RuleCard
        icon={<RotateCcw className="size-[18px]" />}
        title={AUTOMATION_LABELS.retorno}
        desc="Procura quem fez manutenção, compareceu e saiu sem deixar a próxima marcada."
        rule={current.retorno}
        onChange={(retorno) => patch({ retorno })}
        extra={
          <>
            <Field label="Dias após o atendimento" htmlFor="after">
              <Input
                id="after"
                type="number"
                min={1}
                max={365}
                value={current.retorno.afterDays}
                onChange={(e) =>
                  patch({
                    retorno: {
                      ...current.retorno,
                      afterDays: Number(e.target.value) || 30,
                    },
                  })
                }
              />
            </Field>
            <Field
              label="O que conta como manutenção"
              htmlFor="keywords"
              className="md:col-span-2"
            >
              <Input
                id="keywords"
                value={current.retorno.procedureKeywords.join(", ")}
                onChange={(e) =>
                  patch({
                    retorno: {
                      ...current.retorno,
                      procedureKeywords: e.target.value
                        .split(",")
                        .map((k) => k.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
              <Hint>
                Palavras separadas por vírgula, comparadas com o nome do
                procedimento. Ex.: manutenção, limpeza, profilaxia.
              </Hint>
            </Field>
          </>
        }
      />

      <HolidaysCard />

      {update.isError && (
        <ErrorState
          compact
          error={update.error}
          title="Não foi possível salvar as automações"
          onRetry={save}
        />
      )}

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? (
            <>
              <RefreshCw className="size-4 animate-spin" /> Salvando…
            </>
          ) : dirty ? (
            "Salvar alterações"
          ) : (
            <>
              <Check className="size-4" /> Tudo salvo
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/** Regra de uma automação: liga/desliga, texto e campos próprios. */
function RuleCard({
  icon,
  title,
  desc,
  warning,
  rule,
  onChange,
  extra,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  warning?: string;
  rule: { enabled: boolean; template: string };
  onChange: (rule: never) => void;
  extra?: ReactNode;
}) {
  const preview = renderTemplate(rule.template, {
    nome: "Marina",
    empresa: "sua empresa",
    data: "sexta-feira, 12/09",
    hora: "14:30",
    procedimento: "avaliação",
    profissional: "Dra. Ana",
  });

  return (
    <Card className={cn("gap-0 p-0", !rule.enabled && "opacity-70")}>
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-[18px]">
        <div className="flex gap-3">
          <span className="mt-0.5 text-muted-foreground">{icon}</span>
          <div>
            <div className="text-base font-semibold tracking-[-0.01em]">{title}</div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">{desc}</div>
          </div>
        </div>
        <Switch
          checked={rule.enabled}
          onCheckedChange={(enabled) =>
            onChange({ ...rule, enabled } as never)
          }
          aria-label={`Ativar ${title}`}
        />
      </div>

      {warning && (
        <div
          className="flex gap-2 px-6 py-3 text-[13px]"
          style={{ background: "var(--warning-tint, var(--secondary))" }}
        >
          <AlertTriangle className="mt-0.5 size-4 flex-none text-muted-foreground" />
          <span className="text-secondary-foreground">{warning}</span>
        </div>
      )}

      <div className="grid gap-5 p-6 md:grid-cols-2">
        {extra}
        <Field label="Mensagem" htmlFor={`tpl-${title}`} className="md:col-span-2">
          <Textarea
            id={`tpl-${title}`}
            rows={3}
            value={rule.template}
            onChange={(e) =>
              onChange({ ...rule, template: e.target.value } as never)
            }
          />
          <Hint>
            Marcadores disponíveis:{" "}
            {TEMPLATE_PLACEHOLDERS.map((p) => `{${p}}`).join(" · ")}
          </Hint>
        </Field>

        <div className="md:col-span-2">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Como o cliente recebe
          </div>
          <div className="rounded-[var(--radius-sm)] border border-border bg-secondary px-3.5 py-2.5 text-[13.5px] leading-[1.5]">
            {preview || "—"}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Calendário de feriados: nacionais importados, locais na mão. */
function HolidaysCard() {
  const year = new Date().getFullYear();
  const { data: holidays = [], isLoading } = useHolidays(year);
  const create = useCreateHoliday();
  const remove = useDeleteHoliday();
  const sync = useSyncHolidays();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");

  function add() {
    if (!date.trim() || !name.trim()) return;
    create.mutate(
      { date, name },
      {
        onSuccess: () => {
          setDate("");
          setName("");
        },
      },
    );
  }

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-[18px]">
        <div className="flex gap-3">
          <CalendarDays className="mt-0.5 size-[18px] text-muted-foreground" />
          <div>
            <div className="text-base font-semibold tracking-[-0.01em]">
              Feriados de {year}
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              Dias em que as mensagens automáticas são adiadas. Cadastre à mão os
              feriados da cidade e os recessos — nenhuma lista nacional os conhece.
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => sync.mutate(year)}
          disabled={sync.isPending}
        >
          <CalendarPlus className="size-4" />
          {sync.isPending ? "Importando…" : "Importar nacionais"}
        </Button>
      </div>

      <div className="grid gap-3 border-b border-border p-6 md:grid-cols-[180px_1fr_auto]">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Data do feriado"
        />
        <Input
          placeholder="Nome (ex.: Aniversário da cidade)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Nome do feriado"
        />
        <Button type="button" onClick={add} disabled={create.isPending}>
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>

      {isLoading ? (
        <div className="px-6 py-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : holidays.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-muted-foreground">
          Nenhum feriado cadastrado para {year}.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {holidays.map((holiday) => (
            <li
              key={holiday.id}
              className="flex items-center gap-3 px-6 py-3 text-sm"
            >
              <span className="tabular w-[110px] flex-none text-muted-foreground">
                {holiday.date.split("-").reverse().join("/")}
              </span>
              <span className="flex-1">{holiday.name}</span>
              <span className="text-xs text-muted-foreground">
                {holiday.scope === "nacional" ? "Nacional" : "Local"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remover ${holiday.name}`}
                onClick={() => remove.mutate(holiday.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="border-b border-border px-6 py-[18px]">
      <div className="text-base font-semibold tracking-[-0.01em]">{title}</div>
      <div className="mt-0.5 text-[13px] text-muted-foreground">{desc}</div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-[var(--radius-sm)] border border-border p-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function AutomationsSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-48 w-full rounded-[var(--radius)]" />
      ))}
    </div>
  );
}
