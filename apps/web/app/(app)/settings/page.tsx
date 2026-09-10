"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  type AvailabilitySlot,
  type ClinicSettingsDto,
  clinicSettingsSchema,
  DEFAULT_AVAILABILITY,
  MEDIA_TYPE_LABELS,
  MEDIA_TYPES,
  type MediaType,
  type Tone,
} from "@dentaltrack/shared";
import {
  Bot,
  Calendar,
  Check,
  Info,
  RefreshCw,
  Sparkles,
  Upload,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shell/page-header";
import { ProceduresTab } from "@/components/settings/procedures-tab";
import { TagsTab } from "@/components/settings/tags-tab";
import { AutomationsTab } from "@/components/settings/automations-tab";
import { IntegrationTab } from "@/components/settings/integration-tab";
import { WhatsappTab } from "@/components/settings/whatsapp-tab";
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
  { value: "whatsapp", label: "WhatsApp" },
  { value: "automacoes", label: "Automações" },
  { value: "integracao", label: "Integração" },
] as const;
type Tab = (typeof TAB_OPTIONS)[number]["value"];

function requestedTab(value: string | null): Tab {
  return TAB_OPTIONS.some((option) => option.value === value)
    ? (value as Tab)
    : "identidade";
}

const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: "formal", label: "Formal" },
  { value: "amigavel", label: "Amigável" },
  { value: "acolhedor", label: "Acolhedor" },
];

const SPECIALTIES = [
  "Atendimento geral",
  "Vendas e agendamentos",
  "Estética e bem-estar",
  "Atendimentos e avaliações",
];

const BLANK: ClinicSettingsDto = {
  clinicName: "",
  specialty: "",
  description: "",
  assistantName: "",
  tone: "amigavel",
  greeting: "",
  greetingMediaUrl: "",
  greetingMediaType: null,
  instructions: "",
  offerEnabled: false,
  offerText: "",
  offerMediaUrl: "",
  offerMediaType: null,
  offerStartsOn: "",
  offerEndsOn: "",
  availability: DEFAULT_AVAILABILITY,
  whatsappInstance: "",
};

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const { data, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [tab, setTab] = useState<Tab>(() => requestedTab(tabFromUrl));
  const [lastTabFromUrl, setLastTabFromUrl] = useState(tabFromUrl);

  // O banner global pode apontar para esta mesma página enquanto ela já está
  // montada. O React permite ajustar estado durante o render quando uma prop
  // muda; o guard evita render em laço e não prende os cliques manuais à URL.
  if (tabFromUrl !== lastTabFromUrl) {
    setLastTabFromUrl(tabFromUrl);
    setTab(requestedTab(tabFromUrl));
  }

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
  const greetingMediaType = useWatch({ control, name: "greetingMediaType" });
  const offerText = useWatch({ control, name: "offerText" });
  const offerMediaType = useWatch({ control, name: "offerMediaType" });
  const availability = useWatch({ control, name: "availability" });

  // Sincroniza o form com o servidor só quando o usuário NÃO está editando —
  // evita que um refetch/atualização da cache de ["settings"] (assinada também
  // por Sidebar/Topbar) apague o que está sendo digitado.
  useEffect(() => {
    if (data && !formState.isDirty) reset(data);
  }, [data, formState.isDirty, reset]);

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
            <Button
              type="button"
              onClick={onSubmit}
              disabled={!formState.isDirty || update.isPending}
            >
              <Check className="size-4" />
              {update.isPending ? "Salvando…" : "Salvar alterações"}
            </Button>
          </>
        )}
      </PageHeader>

      <div className="mb-[22px] flex items-center gap-3">
        <Segmented
          aria-label="Seções das configurações"
          options={TAB_OPTIONS}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
        {isSettingsTab && update.isSuccess && !formState.isDirty && (
          <span role="status" className="anim-fade text-[12.5px] text-success">
            Alterações salvas.
          </span>
        )}
        {isSettingsTab && update.isError && (
          <span role="alert" className="text-[12.5px] text-destructive">
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
      ) : tab === "whatsapp" ? (
        <div key="whatsapp" className="anim-fade-up">
          <WhatsappTab />
        </div>
      ) : tab === "automacoes" ? (
        <div key="automacoes" className="anim-fade-up">
          <AutomationsTab />
        </div>
      ) : tab === "integracao" ? (
        <div key="integracao" className="anim-fade-up">
          <IntegrationTab />
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
                setSpecialty={(v) =>
                  setValue("specialty", v, { shouldDirty: true })
                }
                greetingMediaType={greetingMediaType}
                setGreetingMediaType={(v) =>
                  setValue("greetingMediaType", v, { shouldDirty: true })
                }
              />
            ) : (
              <OffersFields
                register={register}
                offerEnabled={offerEnabled}
                setOfferEnabled={(v) =>
                  setValue("offerEnabled", v, { shouldDirty: true })
                }
                offerMediaType={offerMediaType}
                setOfferMediaType={(v) =>
                  setValue("offerMediaType", v, { shouldDirty: true })
                }
                availability={availability}
                setAvailability={(a) =>
                  setValue("availability", a, { shouldDirty: true })
                }
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
        <div className="text-base font-semibold tracking-[-0.01em]">
          {title}
        </div>
        {desc && (
          <div className="mt-[3px] text-[13px] text-muted-foreground">
            {desc}
          </div>
        )}
      </div>
      {children}
    </Card>
  );
}

/** Campo rotulado (label em cima, hint embaixo). `htmlFor` associa ao controle (a11y). */
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-[7px] text-[13px] font-medium">
        {label}
      </Label>
      {children}
      {hint && (
        <p className="mt-[7px] text-[12px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

type Register = ReturnType<typeof useForm<ClinicSettingsDto>>["register"];
type MediaUrlField = "greetingMediaUrl" | "offerMediaUrl";

/**
 * Campos de mídia (F6): URL pública + tipo. Enviados pelo bot no WhatsApp
 * (saudação/oferta). "Sem mídia" limpa o tipo — só texto.
 */
function MediaFields({
  register,
  urlName,
  urlPlaceholder,
  hint,
  type,
  setType,
}: {
  register: Register;
  urlName: MediaUrlField;
  urlPlaceholder: string;
  hint: string;
  type: MediaType | null;
  setType: (v: MediaType | null) => void;
}) {
  return (
    <div className="mt-[18px] grid grid-cols-[minmax(0,1fr)_190px] gap-3 max-[560px]:grid-cols-1">
      <Field label="Mídia (URL pública)" hint={hint} htmlFor={urlName}>
        <Input
          id={urlName}
          type="url"
          {...register(urlName)}
          placeholder={urlPlaceholder}
        />
      </Field>
      <Field label="Tipo">
        <Select
          value={type ?? "none"}
          onValueChange={(v) => setType(v === "none" ? null : (v as MediaType))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem mídia</SelectItem>
            {MEDIA_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {MEDIA_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/** Aba "Identidade & Persona". */
function IdentityFields({
  register,
  tone,
  setTone,
  specialty,
  setSpecialty,
  greetingMediaType,
  setGreetingMediaType,
}: {
  register: Register;
  tone: Tone;
  setTone: (v: Tone) => void;
  specialty: string;
  setSpecialty: (v: string) => void;
  greetingMediaType: MediaType | null;
  setGreetingMediaType: (v: MediaType | null) => void;
}) {
  // Garante que o valor carregado apareça mesmo fora da lista padrão.
  const specialtyOptions = Array.from(
    new Set([...SPECIALTIES, specialty].filter((s) => s.trim().length > 0)),
  );

  return (
    <>
      <SectionCard
        title="Identidade da empresa"
        desc="Como o agente se apresenta aos clientes."
      >
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
          <Field label="Nome da empresa" htmlFor="set-clinic-name">
            <Input
              id="set-clinic-name"
              {...register("clinicName")}
              placeholder="Nome da sua empresa"
            />
          </Field>
          <Field label="Especialidade" htmlFor="set-specialty">
            <Select value={specialty || undefined} onValueChange={setSpecialty}>
              <SelectTrigger id="set-specialty" className="w-full">
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
          <Segmented
            aria-label="Tom de voz"
            options={TONE_OPTIONS}
            value={tone}
            onChange={setTone}
          />
        </Field>
        <div className="h-[18px]" />
        <Field
          label="Nome do assistente"
          hint="Aparece no topo do chat e na apresentação."
          htmlFor="set-assistant"
        >
          <Input
            id="set-assistant"
            {...register("assistantName")}
            placeholder="Ex.: Sofia"
          />
        </Field>
        <div className="h-[18px]" />
        <Field
          label="Mensagem de saudação"
          hint="Primeira mensagem que o cliente recebe."
          htmlFor="set-greeting"
        >
          <Textarea
            id="set-greeting"
            rows={3}
            {...register("greeting")}
            placeholder="Olá! Sou a assistente virtual da empresa…"
          />
        </Field>
        <MediaFields
          register={register}
          urlName="greetingMediaUrl"
          urlPlaceholder="https://…/boas-vindas.jpg"
          hint="Imagem, vídeo ou áudio enviado no 1º contato pelo WhatsApp."
          type={greetingMediaType}
          setType={setGreetingMediaType}
        />
      </SectionCard>
    </>
  );
}

/** Aba "Ofertas & Instruções". */
function OffersFields({
  register,
  offerEnabled,
  setOfferEnabled,
  offerMediaType,
  setOfferMediaType,
  availability,
  setAvailability,
}: {
  register: Register;
  offerEnabled: boolean;
  setOfferEnabled: (v: boolean) => void;
  offerMediaType: MediaType | null;
  setOfferMediaType: (v: MediaType | null) => void;
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
                offerEnabled
                  ? "text-success"
                  : "bg-secondary text-muted-foreground",
              )}
              style={
                offerEnabled ? { background: "var(--success-tint)" } : undefined
              }
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
          <Switch
            checked={offerEnabled}
            onCheckedChange={setOfferEnabled}
            aria-label="Ativar oferta"
          />
        </div>
        <Field
          label="Texto da oferta"
          hint="Linguagem natural — o agente adapta ao contexto."
          htmlFor="set-offer-text"
        >
          <Textarea
            id="set-offer-text"
            rows={3}
            {...register("offerText")}
            placeholder="Ex.: Avaliação inicial gratuita neste mês para novos clientes."
          />
        </Field>
        <div className="mt-[18px] grid grid-cols-2 gap-4 max-[560px]:grid-cols-1">
          <Field label="Início da vigência" htmlFor="set-offer-start">
            <IconInput
              id="set-offer-start"
              icon={Calendar}
              {...register("offerStartsOn")}
              placeholder="01/06/2026"
            />
          </Field>
          <Field label="Fim da vigência" htmlFor="set-offer-end">
            <IconInput
              id="set-offer-end"
              icon={Calendar}
              {...register("offerEndsOn")}
              placeholder="30/06/2026"
            />
          </Field>
        </div>
        <MediaFields
          register={register}
          urlName="offerMediaUrl"
          urlPlaceholder="https://…/promocao.jpg"
          hint="Imagem, vídeo, áudio ou catálogo enviado junto da oferta no WhatsApp."
          type={offerMediaType}
          setType={setOfferMediaType}
        />
      </SectionCard>

      <SectionCard
        title="Instruções específicas"
        desc="Regras injetadas no comportamento do agente a cada conversa."
      >
        <Field
          label="Diretrizes da empresa"
          hint="Ex.: 'sempre ofereça a avaliação antes de orçar', 'não passe valores fechados por mensagem'."
          htmlFor="set-instructions"
        >
          <Textarea
            id="set-instructions"
            rows={5}
            {...register("instructions")}
            placeholder="• Sempre ofereça a avaliação inicial antes de informar valores."
          />
        </Field>
        <div
          className="mt-3.5 flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2.5 text-[12.5px]"
          style={{
            background: "var(--primary-tint)",
            color: "var(--primary-active)",
          }}
        >
          <Info className="size-[15px] shrink-0" /> Estas instruções entram no
          prompt do agente automaticamente.
        </div>
      </SectionCard>

      <SectionCard
        title="Disponibilidade"
        desc="Orienta o bot ao propor horários de agendamento."
      >
        <div className="flex flex-col gap-2.5">
          {availability.map((slot, idx) => (
            <div
              key={slot.day}
              className="flex items-center justify-between border-b border-border py-2.5"
            >
              <span className="text-sm font-medium">{slot.day}</span>
              <span className="flex items-center gap-3">
                <span className="tabular text-[13px] text-muted-foreground">
                  {slot.hours}
                </span>
                <Switch
                  checked={slot.open}
                  onCheckedChange={(open) =>
                    setAvailability(
                      availability.map((s, i) =>
                        i === idx ? { ...s, open } : s,
                      ),
                    )
                  }
                  aria-label={`Atendimento em ${slot.day}`}
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
      <Icon className="pointer-events-none absolute left-[13px] top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
      <Input className={cn("pl-10", className)} {...props} />
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
  const clinic = clinicName.trim() || "sua empresa";
  const greet =
    greeting.trim() ||
    `Olá! Sou ${assistantName.trim() ? `a ${name}, assistente` : "o assistente"} da ${clinic}. Como posso ajudar você hoje?`;
  const offer = offerText.trim();
  const toneLabel =
    TONE_OPTIONS.find((t) => t.value === tone)?.label.toLowerCase() ?? tone;

  return (
    <div className="sticky top-0">
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-[13px]">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-primary-tint text-primary">
            <Bot className="size-[18px]" />
          </span>
          <div className="flex-1">
            <div className="text-[13.5px] font-semibold">
              Preview do assistente
            </div>
            <div className="text-[11.5px] text-muted-foreground">
              Tom: {toneLabel}
            </div>
          </div>
          <span className="size-2 rounded-full bg-success" />
        </div>
        <div className="flex min-h-[220px] flex-col gap-3 bg-background px-4 py-[18px]">
          <PreviewBubble>{greet}</PreviewBubble>
          {offerEnabled && offer && (
            <PreviewBubble>
              Aproveite: temos <strong className="text-primary">{offer}</strong>{" "}
              para novos clientes. Quer que eu já agende a sua?
            </PreviewBubble>
          )}
          <div className="max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-primary px-[13px] py-2.5 text-[13.5px] text-white">
            Quero agendar, sim!
          </div>
        </div>
      </Card>
      <div className="mt-3 flex items-center justify-center gap-[7px] text-[12px] text-muted-foreground">
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
