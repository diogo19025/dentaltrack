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
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Plus,
  RefreshCw,
  RotateCcw,
  SendHorizontal,
  Trash2,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
 * A tela mostra só a visão geral: quatro grupos, cada um com o estado das suas
 * automações. Os campos ficam num painel por grupo (Dialog) — clicar fora
 * fecha e devolve a visão geral. O rascunho sobrevive ao fechar: o "Salvar"
 * é um só, na aba, e vale para o que foi mexido em qualquer painel.
 *
 * Fora do handoff de design; segue o design system existente (produto.md § Design).
 */

type GroupKey = "envio" | "lembretes" | "faltas" | "retorno";

/**
 * Fusos do Brasil, um por GMT. Só atendemos empresas em solo brasileiro, e o
 * dono reconhece o GMT e as cidades — não a zona IANA. O Brasil não tem
 * horário de verão desde 2019, então o GMT vale o ano inteiro.
 */
const BRAZIL_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Noronha", label: "GMT-2 · Fernando de Noronha" },
  {
    value: "America/Sao_Paulo",
    label: "GMT-3 · Brasília, São Paulo, Rio de Janeiro",
  },
  { value: "America/Manaus", label: "GMT-4 · Manaus, Cuiabá, Campo Grande" },
  { value: "America/Rio_Branco", label: "GMT-5 · Rio Branco" },
];

const GROUPS: Record<
  GroupKey,
  { title: string; desc: string; icon: ReactNode }
> = {
  envio: {
    title: "Regras de envio",
    desc: "Horário, fuso, teto diário e feriados. Vale para todas as automações.",
    icon: <SendHorizontal className="size-[18px]" />,
  },
  lembretes: {
    title: "Lembretes de consulta",
    desc: "Confirmações antes do horário marcado.",
    icon: <BellRing className="size-[18px]" />,
  },
  faltas: {
    title: "Atrasos e faltas",
    desc: "Quem não chegou na hora e quem não apareceu.",
    icon: <UserX className="size-[18px]" />,
  },
  retorno: {
    title: "Retorno de clientes",
    desc: "Quem compareceu e saiu sem deixar a próxima marcada.",
    icon: <RotateCcw className="size-[18px]" />,
  },
};

export function AutomationsTab() {
  const { data, isLoading, isError, error, refetch } = useAutomations();
  const update = useUpdateAutomations();
  // Só as edições pendentes ficam em estado; o resto vem do servidor. Derivar
  // em vez de sincronizar num efeito evita o refetch apagar o que está sendo
  // digitado — e dispensa o efeito por completo.
  const [edits, setEdits] = useState<AutomationSettings | null>(null);
  const [open, setOpen] = useState<GroupKey | null>(null);

  if (isError && !data) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  if (isLoading || !data) return <AutomationsSkeleton />;

  const current = edits ?? data;
  const dirty =
    edits !== null && JSON.stringify(edits) !== JSON.stringify(data);
  const patch = (values: Partial<AutomationSettings>) =>
    setEdits({ ...current, ...values });

  function save() {
    // Salvo, o rascunho é descartado e a tela volta a espelhar o servidor.
    update.mutate(current, { onSuccess: () => setEdits(null) });
  }

  const reminders = [
    current.lembrete3d,
    current.lembrete1d,
    current.lembrete1h,
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <GroupCard
          group="envio"
          summary={`${current.sendWindowStart}–${current.sendWindowEnd} · até ${current.dailyCap} mensagens/dia`}
          items={[
            { label: "Não enviar em feriados", enabled: current.skipHolidays },
            {
              label: "Não enviar em fins de semana",
              enabled: current.skipWeekends,
            },
          ]}
          onOpen={() => setOpen("envio")}
        />
        <GroupCard
          group="lembretes"
          summary={activeSummary(reminders)}
          items={[
            {
              label: AUTOMATION_LABELS.lembrete_3d,
              enabled: current.lembrete3d.enabled,
            },
            {
              label: AUTOMATION_LABELS.lembrete_1d,
              enabled: current.lembrete1d.enabled,
            },
            {
              label: AUTOMATION_LABELS.lembrete_1h,
              enabled: current.lembrete1h.enabled,
            },
          ]}
          onOpen={() => setOpen("lembretes")}
        />
        <GroupCard
          group="faltas"
          summary={activeSummary([current.atraso, current.falta])}
          items={[
            {
              label: AUTOMATION_LABELS.atraso,
              enabled: current.atraso.enabled,
            },
            { label: AUTOMATION_LABELS.falta, enabled: current.falta.enabled },
          ]}
          onOpen={() => setOpen("faltas")}
        />
        <GroupCard
          group="retorno"
          summary={
            current.retorno.enabled
              ? `${current.retorno.afterDays} dias após o atendimento`
              : "Desligado"
          }
          items={[
            {
              label: AUTOMATION_LABELS.retorno,
              enabled: current.retorno.enabled,
            },
          ]}
          onOpen={() => setOpen("retorno")}
        />
      </div>

      <GroupDialog group={open} onClose={() => setOpen(null)}>
        {open === "envio" && (
          <>
            <Card className="gap-0 p-0">
              <SectionHeader
                title="Como e quando enviar"
                desc="O canal é um WhatsApp comum: disparo fora de hora ou em rajada põe o número da empresa em risco."
              />
              <div className="grid gap-5 p-6 md:grid-cols-2">
                <Field label="Fuso horário" htmlFor="tz">
                  <TimezoneSelect
                    id="tz"
                    value={current.timezone}
                    onChange={(timezone) => patch({ timezone })}
                  />
                  <Hint>Ancora a janela de envio e os lembretes.</Hint>
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
                  desc="Útil para empresas que só atendem em dias úteis."
                  checked={current.skipWeekends}
                  onChange={(skipWeekends) => patch({ skipWeekends })}
                />
              </div>
            </Card>

            <HolidaysCard />
          </>
        )}

        {open === "lembretes" && (
          <>
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
          </>
        )}

        {open === "faltas" && (
          <>
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
                    <Hint>
                      Insistir além disso vira spam e arrisca o número.
                    </Hint>
                  </Field>
                  <Field
                    label="Intervalo entre tentativas (horas)"
                    htmlFor="interval"
                  >
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
          </>
        )}

        {open === "retorno" && (
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
                  <KeywordsInput
                    id="keywords"
                    value={current.retorno.procedureKeywords}
                    onChange={(procedureKeywords) =>
                      patch({
                        retorno: { ...current.retorno, procedureKeywords },
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
        )}
      </GroupDialog>

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

/**
 * Lista fechada de fusos do Brasil. Um valor gravado fora da lista (banco
 * antigo, ajuste manual) continua aparecendo como opção para não sumir do
 * campo nem ser trocado sem querer.
 */
function TimezoneSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const known = BRAZIL_TIMEZONES.some((tz) => tz.value === value);
  const options = known
    ? BRAZIL_TIMEZONES
    : [{ value, label: value }, ...BRAZIL_TIMEZONES];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label="Fuso horário">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((tz) => (
          <SelectItem key={tz.value} value={tz.value}>
            {tz.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function parseKeywords(text: string) {
  return text
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Lista de palavras separadas por vírgula. O texto cru fica local enquanto
 * se digita — normalizar a cada tecla apagava a vírgula e o espaço recém
 * digitados, porque viravam uma palavra vazia e eram descartados. A lista
 * limpa sobe a cada tecla; o texto só é arrumado ao sair do campo.
 */
function KeywordsInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (keywords: string[]) => void;
}) {
  const fromProps = value.join(", ");
  const [text, setText] = useState(fromProps);
  const [seen, setSeen] = useState(fromProps);
  // Valor mudou por fora (salvar, refetch, reset): o texto acompanha.
  if (seen !== fromProps) {
    setSeen(fromProps);
    if (parseKeywords(text).join(", ") !== fromProps) setText(fromProps);
  }
  return (
    <Input
      id={id}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseKeywords(e.target.value));
      }}
      onBlur={() => setText(parseKeywords(text).join(", "))}
    />
  );
}

/** "2 de 3 ativos" — o resumo que a visão geral mostra sem abrir o painel. */
function activeSummary(rules: { enabled: boolean }[]) {
  const on = rules.filter((r) => r.enabled).length;
  if (on === 0) return "Tudo desligado";
  if (rules.length === 1) return "Ativo";
  return `${on} de ${rules.length} ativos`;
}

/** Cartão de um grupo na visão geral: estado de cada automação + botão para abrir. */
function GroupCard({
  group,
  summary,
  items,
  onOpen,
}: {
  group: GroupKey;
  summary: string;
  items: { label: string; enabled: boolean }[];
  onOpen: () => void;
}) {
  const { title, desc, icon } = GROUPS[group];
  return (
    <Card className="gap-0 p-0">
      <div className="flex items-start gap-3 border-b border-border px-6 py-[18px]">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold tracking-[-0.01em]">
            {title}
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">{desc}</div>
        </div>
      </div>

      <ul className="flex flex-col gap-2 px-6 py-4">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden
              className={cn(
                "size-2 flex-none rounded-full",
                item.enabled
                  ? "bg-[var(--success)]"
                  : "bg-[var(--border-strong)]",
              )}
            />
            <span
              className={cn("flex-1", !item.enabled && "text-muted-foreground")}
            >
              {item.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {item.enabled ? "Ativo" : "Desligado"}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border px-6 py-3">
        <span className="tabular text-xs text-muted-foreground">{summary}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpen}
          aria-label={`Configurar ${title}`}
        >
          Configurar <ChevronRight className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

/**
 * Painel de um grupo. Clicar fora (ou Esc) fecha e volta à visão geral; o que
 * foi digitado continua no rascunho da aba até o "Salvar".
 */
function GroupDialog({
  group,
  onClose,
  children,
}: {
  group: GroupKey | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const meta = group ? GROUPS[group] : null;
  return (
    <Dialog open={group !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="flex-none border-b border-border px-6 py-[18px]">
          <DialogTitle className="flex items-center gap-2.5 text-base tracking-[-0.01em]">
            <span className="text-muted-foreground">{meta?.icon}</span>
            {meta?.title}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {meta?.desc}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 overflow-y-auto bg-background p-6">
          {children}
        </div>

        <DialogFooter className="flex-none items-center border-t border-border px-6 py-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            As alterações ficam no rascunho — salve pelo botão da aba.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Voltar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
            <div className="text-base font-semibold tracking-[-0.01em]">
              {title}
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {desc}
            </div>
          </div>
        </div>
        <Switch
          checked={rule.enabled}
          onCheckedChange={(enabled) => onChange({ ...rule, enabled } as never)}
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
        <Field
          label="Mensagem"
          htmlFor={`tpl-${title}`}
          className="md:col-span-2"
        >
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

/** Quantos feriados o painel mostra antes do "Mostrar todos". */
const HOLIDAYS_PREVIEW = 5;

/** Calendário de feriados: nacionais importados, locais na mão. */
function HolidaysCard() {
  const year = new Date().getFullYear();
  const { data: holidays = [], isLoading } = useHolidays(year);
  const create = useCreateHoliday();
  const remove = useDeleteHoliday();
  const sync = useSyncHolidays();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [showAll, setShowAll] = useState(false);

  // A lista vem por data. Sem "todos", o painel mostra só os próximos 5 a
  // partir de hoje (ou os 5 últimos, se o ano já passou) — o resto fica
  // atrás de um botão e rola dentro da própria lista, sem esticar o painel.
  const today = new Date().toISOString().slice(0, 10);
  const firstUpcoming = holidays.findIndex((h) => h.date >= today);
  const start =
    firstUpcoming === -1
      ? Math.max(0, holidays.length - HOLIDAYS_PREVIEW)
      : Math.min(
          firstUpcoming,
          Math.max(0, holidays.length - HOLIDAYS_PREVIEW),
        );
  const visible = showAll
    ? holidays
    : holidays.slice(start, start + HOLIDAYS_PREVIEW);
  const hidden = holidays.length - visible.length;

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
              Dias em que as mensagens automáticas são adiadas. Cadastre à mão
              os feriados da cidade e os recessos — nenhuma lista nacional os
              conhece.
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
        <ul
          className={cn(
            "divide-y divide-border",
            showAll && "max-h-72 overflow-y-auto",
          )}
        >
          {visible.map((holiday) => (
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

      {holidays.length > HOLIDAYS_PREVIEW && (
        <div className="border-t border-border px-6 py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? (
              <>
                <ChevronUp className="size-4" /> Mostrar menos
              </>
            ) : (
              <>
                <ChevronDown className="size-4" /> Mostrar todos ({hidden} a
                mais)
              </>
            )}
          </Button>
        </div>
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
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-56 w-full rounded-[var(--radius)]" />
      ))}
    </div>
  );
}
