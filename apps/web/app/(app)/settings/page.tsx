"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type AvailabilitySlot,
  type ClinicSettingsDto,
  clinicSettingsSchema,
  DEFAULT_AVAILABILITY,
  type Tone,
} from "@dentaltrack/shared";
import { Bot, Calendar, Check, Info, RefreshCw, Sparkles, Upload } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shell/page-header";
import { ProceduresTab } from "@/components/settings/procedures-tab";
import { TagsTab } from "@/components/settings/tags-tab";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

/**
 * /settings — réplica 1:1 de `screen_settings.jsx` (FE-2.1..2.5). Duas abas
 * (Identidade & Persona · Ofertas & Instruções) com RHF + Zod compartilhado,
 * Preview do bot reativo (sticky) e persistência via PATCH /settings (que
 * alimenta o system prompt — BE-1.3). Dados via TanStack Query.
 */

const TAB_OPTIONS = [
  { value: "identidade", label: "Identidade & Persona" },
  { value: "ofertas", label: "Ofertas & Instruções" },
  { value: "procedimentos", label: "Procedimentos" },
  { value: "tags", label: "Tags" },
] as const;
type Tab = (typeof TAB_OPTIONS)[number]["value"];

const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: "formal", label: "Formal" },
  { value: "amigavel", label: "Amigável" },
  { value: "acolhedor", label: "Acolhedor" },
];

const SPECIALTIES = [
  "Odontologia geral",
  "Estética e harmonização",
  "Implantodontia",
  "Ortodontia",
];

const BLANK: ClinicSettingsDto = {
  clinicName: "",
  specialty: "",
  description: "",
  assistantName: "",
  tone: "amigavel",
  greeting: "",
  instructions: "",
  offerEnabled: false,
  offerText: "",
  offerStartsOn: "",
  offerEndsOn: "",
  availability: DEFAULT_AVAILABILITY,
};

export default function SettingsPage() {
  const { data, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [tab, setTab] = useState<Tab>("identidade");

  const form = useForm<ClinicSettingsDto>({
    resolver: zodResolver(clinicSettingsSchema),
    defaultValues: BLANK,
  });
  const { register, handleSubmit, reset, setValue, formState, control } = form;

  // Assinaturas reativas (useWatch é compatível com o React Compiler).
  const tone = useWatch({ control, name: "tone" });
  const offerEnabled = useWatch({ control, name: "offerEnabled" });
  const specialty = useWatch({ control, name: "specialty" });
  const assistantName = useWatch({ control, name: "assistantName" });
  const clinicName = useWatch({ control, name: "clinicName" });
  const greeting = useWatch({ control, name: "greeting" });
  const offerText = useWatch({ control, name: "offerText" });
  const availability = useWatch({ control, name: "availability" });

  // Carrega os valores reais assim que a API responde.
  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const onSubmit = handleSubmit((values) =>
    update.mutate(values, { onSuccess: (saved) => reset(saved) }),
  );

  if (isLoading) return <SettingsSkeleton />;

  const isSettingsTab = tab === "identidade" || tab === "ofertas";

  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Defina como o assistente de IA se comporta — sem escrever código."
      >
        {isSettingsTab && (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => reset(data ?? BLANK)}
              disabled={!formState.isDirty || update.isPending}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={onSubmit} disabled={!formState.isDirty || update.isPending}>
              <Check className="size-4" />
              {update.isPending ? "Salvando…" : "Salvar alterações"}
            </Button>
          </>
        )}
      </PageHeader>

      <div className="mb-[22px] flex items-center gap-3">
        <Segmented options={TAB_OPTIONS} value={tab} onChange={(v) => setTab(v as Tab)} />
        {isSettingsTab && update.isSuccess && !formState.isDirty && (
          <span className="anim-fade text-[12.5px] text-success">Alterações salvas.</span>
        )}
        {isSettingsTab && update.isError && (
          <span className="text-[12.5px] text-destructive">
            Não foi possível salvar. Tente novamente.
          </span>
        )}
      </div>

      {tab === "procedimentos" ? (
        <div key="procedimentos" className="anim-fade-up">
          <ProceduresTab />
        </div>
      ) : tab === "tags" ? (
        <div key="tags" className="anim-fade-up">
          <TagsTab />
        </div>
      ) : (
        <form
          key={tab}
          onSubmit={onSubmit}
          className="anim-fade-up grid grid-cols-[minmax(0,1fr)_320px] items-start gap-[22px] max-[900px]:grid-cols-1"
        >
          <div className="flex flex-col gap-[18px]">
            {tab === "identidade" ? (
              <IdentityFields
                register={register}
                tone={tone}
                setTone={(v) => setValue("tone", v, { shouldDirty: true })}
                specialty={specialty}
                setSpecialty={(v) => setValue("specialty", v, { shouldDirty: true })}
              />
            ) : (
              <OffersFields
                register={register}
                offerEnabled={offerEnabled}
                setOfferEnabled={(v) => setValue("offerEnabled", v, { shouldDirty: true })}
                availability={availability}
                setAvailability={(a) => setValue("availability", a, { shouldDirty: true })}
              />
            )}
          </div>

          <BotPreview
            tone={tone}
            assistantName={assistantName}
            clinicName={clinicName}
            greeting={greeting}
            offerEnabled={offerEnabled}
            offerText={offerText}
          />
        </form>
      )}
    </>
  );
}

/** Controle segmentado (abas e tom de voz) — espelha `Segmented` do design. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-muted p-[3px]">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-3.5 py-1.5 text-[13.5px] font-medium transition-all",
            value === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-foreground/60 hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Card de seção (título + descrição + conteúdo). */
function SectionCard({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 p-[22px_24px]">
      <div className="mb-5">
        <div className="text-base font-semibold tracking-[-0.01em]">{title}</div>
        {desc && <div className="mt-0.5 text-[13px] text-muted-foreground">{desc}</div>}
      </div>
      {children}
    </Card>
  );
}

/** Campo rotulado (label em cima, hint embaixo). */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label className="mb-2 text-[13px] font-medium">{label}</Label>
      {children}
      {hint && <p className="mt-1.5 text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

type Register = ReturnType<typeof useForm<ClinicSettingsDto>>["register"];

/** Aba "Identidade & Persona". */
function IdentityFields({
  register,
  tone,
  setTone,
  specialty,
  setSpecialty,
}: {
  register: Register;
  tone: Tone;
  setTone: (v: Tone) => void;
  specialty: string;
  setSpecialty: (v: string) => void;
}) {
  // Garante que o valor carregado apareça mesmo fora da lista padrão.
  const specialtyOptions = Array.from(
    new Set([...SPECIALTIES, specialty].filter((s) => s.trim().length > 0)),
  );

  return (
    <>
      <SectionCard title="Identidade da clínica" desc="Como o agente se apresenta aos pacientes.">
        <div className="mb-[18px] flex items-center gap-[18px]">
          <div className="flex size-[76px] shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-[16px] border-[1.5px] border-dashed border-border-strong bg-muted text-muted-foreground">
            <Upload className="size-[18px]" />
            <span className="text-[10.5px]">Logo</span>
          </div>
          <div className="flex-1">
            <p className="mb-2 text-[12px] text-muted-foreground">
              PNG ou SVG, fundo transparente. Até 1&nbsp;MB.
            </p>
            <Button type="button" variant="secondary" size="sm">
              <Upload className="size-4" /> Enviar logo
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <Field label="Nome da clínica">
            <Input {...register("clinicName")} placeholder="Nome da sua clínica" />
          </Field>
          <Field label="Especialidade">
            <Select value={specialty || undefined} onValueChange={setSpecialty}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {specialtyOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Persona do assistente"
        desc="O tom de voz e a saudação inicial da conversa."
      >
        <Field label="Tom de voz">
          <Segmented options={TONE_OPTIONS} value={tone} onChange={setTone} />
        </Field>
        <div className="h-[18px]" />
        <Field label="Nome do assistente" hint="Aparece no topo do chat e na apresentação.">
          <Input {...register("assistantName")} placeholder="Ex.: Sofia" />
        </Field>
        <div className="h-[18px]" />
        <Field label="Mensagem de saudação" hint="Primeira mensagem que o paciente recebe.">
          <Textarea
            rows={3}
            {...register("greeting")}
            placeholder="Olá! Sou a assistente virtual da clínica…"
          />
        </Field>
      </SectionCard>
    </>
  );
}

/** Aba "Ofertas & Instruções". */
function OffersFields({
  register,
  offerEnabled,
  setOfferEnabled,
  availability,
  setAvailability,
}: {
  register: Register;
  offerEnabled: boolean;
  setOfferEnabled: (v: boolean) => void;
  availability: AvailabilitySlot[];
  setAvailability: (a: AvailabilitySlot[]) => void;
}) {
  return (
    <>
      <SectionCard
        title="Oferta ativa"
        desc="Promoção que o agente menciona quando fizer sentido na conversa."
      >
        <div className="mb-[18px] flex items-center justify-between rounded-[var(--radius-md)] bg-muted px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex size-[34px] items-center justify-center rounded-[9px]",
                offerEnabled ? "text-success" : "bg-secondary text-muted-foreground",
              )}
              style={offerEnabled ? { background: "var(--success-tint)" } : undefined}
            >
              <Sparkles className="size-4" />
            </span>
            <div>
              <div className="text-[13.5px] font-medium">
                Oferta {offerEnabled ? "ativa" : "pausada"}
              </div>
              <div className="text-[12px] text-muted-foreground">
                O bot {offerEnabled ? "pode" : "não vai"} citar esta promoção.
              </div>
            </div>
          </div>
          <Switch checked={offerEnabled} onCheckedChange={setOfferEnabled} />
        </div>
        <Field label="Texto da oferta" hint="Linguagem natural — o agente adapta ao contexto.">
          <Textarea
            rows={3}
            {...register("offerText")}
            placeholder="Ex.: Avaliação inicial gratuita neste mês para novos pacientes."
          />
        </Field>
        <div className="mt-[18px] grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <Field label="Início da vigência">
            <IconInput icon={Calendar} {...register("offerStartsOn")} placeholder="01/06/2026" />
          </Field>
          <Field label="Fim da vigência">
            <IconInput icon={Calendar} {...register("offerEndsOn")} placeholder="30/06/2026" />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Instruções específicas"
        desc="Regras injetadas no comportamento do agente a cada conversa."
      >
        <Field
          label="Diretrizes da clínica"
          hint="Ex.: 'sempre ofereça a avaliação antes de orçar', 'não passe valores fechados por mensagem'."
        >
          <Textarea
            rows={5}
            {...register("instructions")}
            placeholder="• Sempre ofereça a avaliação inicial antes de informar valores."
          />
        </Field>
        <div
          className="mt-3.5 flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2.5 text-[12.5px]"
          style={{ background: "var(--primary-tint)", color: "var(--primary-active)" }}
        >
          <Info className="size-[15px] shrink-0" /> Estas instruções entram no prompt do agente
          automaticamente.
        </div>
      </SectionCard>

      <SectionCard title="Disponibilidade" desc="Orienta o bot ao propor horários de agendamento.">
        <div className="flex flex-col gap-2.5">
          {availability.map((slot, idx) => (
            <div
              key={slot.day}
              className="flex items-center justify-between border-b border-border py-2.5 last:border-b-0"
            >
              <span className="text-sm font-medium">{slot.day}</span>
              <span className="flex items-center gap-3">
                <span className="tabular text-[13px] text-muted-foreground">{slot.hours}</span>
                <Switch
                  checked={slot.open}
                  onCheckedChange={(open) =>
                    setAvailability(availability.map((s, i) => (i === idx ? { ...s, open } : s)))
                  }
                />
              </span>
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  );
}

/** Input com ícone à esquerda (vigência da oferta). */
function IconInput({
  icon: Icon,
  className,
  ...props
}: React.ComponentProps<"input"> & { icon: typeof Calendar }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className={cn("pl-9", className)} {...props} />
    </div>
  );
}

/** Preview do bot — reflete tom, saudação e oferta em tempo real (sticky). */
function BotPreview({
  tone,
  assistantName,
  clinicName,
  greeting,
  offerEnabled,
  offerText,
}: {
  tone: Tone;
  assistantName: string;
  clinicName: string;
  greeting: string;
  offerEnabled: boolean;
  offerText: string;
}) {
  const name = assistantName.trim() || "assistente";
  const clinic = clinicName.trim() || "sua clínica";
  const greet =
    greeting.trim() ||
    `Olá! Sou ${assistantName.trim() ? `a ${name}` : "o assistente"} da ${clinic}. Como posso ajudar com seu sorriso hoje?`;
  const offer = offerText.trim();
  const toneLabel = TONE_OPTIONS.find((t) => t.value === tone)?.label.toLowerCase() ?? tone;

  return (
    <div className="sticky top-0">
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-[13px]">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-primary-tint text-primary">
            <Bot className="size-[18px]" />
          </span>
          <div className="flex-1">
            <div className="text-[13.5px] font-semibold">Preview do assistente</div>
            <div className="text-[11.5px] text-muted-foreground">Tom: {toneLabel}</div>
          </div>
          <span className="size-2 rounded-full bg-success" />
        </div>
        <div className="flex min-h-[220px] flex-col gap-3 bg-background px-4 py-[18px]">
          <PreviewBubble>{greet}</PreviewBubble>
          {offerEnabled && offer && (
            <PreviewBubble>
              Aproveite: <strong className="text-primary">{offer}</strong>
            </PreviewBubble>
          )}
          <div className="max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-primary px-[13px] py-2.5 text-[13.5px] text-white">
            Quero agendar, sim!
          </div>
        </div>
      </Card>
      <div className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
        <RefreshCw className="size-[13px]" /> Atualiza conforme você edita
      </div>
    </div>
  );
}

/** Bolha do bot no preview (lado esquerdo). */
function PreviewBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[8px] bg-primary-tint text-primary">
        <Bot className="size-3.5" />
      </span>
      <div className="rounded-[14px_14px_14px_4px] border border-border bg-card px-[13px] py-2.5 text-[13.5px] leading-[1.5] shadow-[var(--shadow-xs)]">
        {children}
      </div>
    </div>
  );
}

/** Skeleton enquanto as configurações carregam. */
function SettingsSkeleton() {
  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Defina como o assistente de IA se comporta — sem escrever código."
      />
      <Skeleton className="mb-[22px] h-10 w-80" />
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-[22px] max-[900px]:grid-cols-1">
        <div className="flex flex-col gap-[18px]">
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    </>
  );
}
