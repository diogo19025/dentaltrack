"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  acceptedFormatsLabel,
  type CreateProcedureInput,
  MEDIA_TYPE_LABELS,
  MEDIA_TYPES,
  type MediaType,
  type ProcedureDto,
  type TagColor,
  type TagDto,
} from "@dentaltrack/shared";
import { ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MediaUploadButton } from "@/components/settings/media-upload-button";
import { cn } from "@/lib/utils";
import {
  useCreateProcedure,
  useDeleteProcedure,
  useProcedures,
  useUpdateProcedure,
} from "@/hooks/use-procedures";
import { useTags } from "@/hooks/use-tags";

/** Formata centavos como BRL curto (150000 → "R$ 1.500"). */
function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Resume a faixa de preço de um procedimento. */
function priceLabel(p: ProcedureDto): string {
  const { priceMinCents: min, priceMaxCents: max } = p;
  if (min != null && max != null) return min === max ? formatCents(min) : `${formatCents(min)} – ${formatCents(max)}`;
  if (min != null) return `a partir de ${formatCents(min)}`;
  if (max != null) return `até ${formatCents(max)}`;
  return "—";
}

/** Pílula colorida de uma tag (mini). */
function MiniTag({ name, color }: { name: string; color: TagColor }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `var(--tag-${color}-bg)`, color: `var(--tag-${color}-fg)` }}
    >
      {name}
    </span>
  );
}

/**
 * Aba "Procedimentos" das Configurações (BE-2.2 no FE). Sem mockup no handoff —
 * construída com o design system existente (Card + Table + Dialog), conforme
 * o produto.md § Design. CRUD via TanStack Query contra `/procedures`. Cada procedimento
 * pode ter tags de interesse associadas (relação N:N).
 */
export function ProceduresTab() {
  const { data: procedures = [], isLoading } = useProcedures();
  const { data: tags = [] } = useTags();
  const del = useDeleteProcedure();
  const [editing, setEditing] = useState<ProcedureDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ProcedureDto | null>(null);

  const tagById = new Map(tags.map((t) => [t.id, t]));

  function remove(p: ProcedureDto) {
    del.reset?.();
    setDeleting(p);
  }

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center justify-between border-b border-border px-6 py-[18px]">
        <div>
          <div className="text-base font-semibold tracking-[-0.01em]">Procedimentos</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            O catálogo que o agente usa para sugerir tratamentos e informar valores.
          </div>
        </div>
        <Button type="button" onClick={() => setEditing(null)}>
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>

      {isLoading ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : procedures.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-5" />}
          title="Nenhum procedimento cadastrado"
          desc="Adicione os serviços da empresa para o bot poder sugeri-los e informar valores."
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[12.5px] text-muted-foreground">
              <th className="px-6 py-2.5 font-medium">Procedimento</th>
              <th className="px-3 py-2.5 font-medium">Faixa de preço</th>
              <th className="px-3 py-2.5 font-medium">Duração</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-6 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {procedures.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-accent">
                <td className="px-6 py-3">
                  <div className="font-medium">{p.name}</div>
                  {p.description && (
                    <div className="mt-0.5 line-clamp-1 text-[12.5px] text-muted-foreground">
                      {p.description}
                    </div>
                  )}
                  {p.tagIds.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.tagIds.map((id) => {
                        const t = tagById.get(id);
                        return t ? <MiniTag key={id} name={t.name} color={t.color} /> : null;
                      })}
                    </div>
                  )}
                </td>
                <td className="tabular px-3 py-3 text-muted-foreground">{priceLabel(p)}</td>
                <td className="tabular px-3 py-3 text-muted-foreground">
                  {p.durationMinutes != null ? `${p.durationMinutes} min` : "—"}
                </td>
                <td className="px-3 py-3">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                    style={
                      p.active
                        ? { background: "var(--success-tint)", color: "var(--success)" }
                        : { background: "var(--muted)", color: "var(--muted-foreground)" }
                    }
                  >
                    <span className="size-1.5 rounded-full bg-current" /> {p.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Editar" onClick={() => setEditing(p)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remover"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => remove(p)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing !== undefined && (
        <ProcedureDialog
          key={editing?.id ?? "new"}
          procedure={editing}
          allTags={tags}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Remover procedimento?"
        description={
          deleting
            ? `O procedimento “${deleting.name}” deixará de aparecer no catálogo do agente.`
            : ""
        }
        confirmLabel="Remover"
        destructive
        isPending={del.isPending}
        error={del.isError ? del.error : undefined}
        onConfirm={() => {
          if (!deleting) return;
          del.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </Card>
  );
}

interface ProcForm {
  name: string;
  description: string;
  priceMin: string;
  priceMax: string;
  duration: string;
  active: boolean;
  offerText: string;
  offerMediaUrl: string;
  offerMediaType: MediaType | null;
  tagIds: string[];
}

/** Dialog de criar/editar procedimento. Preços em reais (convertidos p/ centavos). */
function ProcedureDialog({
  procedure,
  allTags,
  onClose,
}: {
  procedure: ProcedureDto | null;
  allTags: TagDto[];
  onClose: () => void;
}) {
  const create = useCreateProcedure();
  const update = useUpdateProcedure();
  const isEdit = procedure != null;
  const pending = create.isPending || update.isPending;

  const { register, handleSubmit, control, setValue } = useForm<ProcForm>({
    defaultValues: {
      name: procedure?.name ?? "",
      description: procedure?.description ?? "",
      priceMin: procedure?.priceMinCents != null ? String(procedure.priceMinCents / 100) : "",
      priceMax: procedure?.priceMaxCents != null ? String(procedure.priceMaxCents / 100) : "",
      duration: procedure?.durationMinutes != null ? String(procedure.durationMinutes) : "",
      active: procedure?.active ?? true,
      offerText: procedure?.offerText ?? "",
      offerMediaUrl: procedure?.offerMediaUrl ?? "",
      offerMediaType: procedure?.offerMediaType ?? null,
      tagIds: procedure?.tagIds ?? [],
    },
  });
  const active = useWatch({ control, name: "active" });
  const offerMediaType = useWatch({ control, name: "offerMediaType" });
  const tagIds = useWatch({ control, name: "tagIds" });

  const toCents = (s: string) => (s.trim() === "" ? undefined : Math.round(Number(s) * 100));
  const toInt = (s: string) => (s.trim() === "" ? undefined : Math.round(Number(s)));

  function toggleTag(id: string) {
    const next = tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id];
    setValue("tagIds", next, { shouldDirty: true });
  }

  const onSubmit = handleSubmit((v) => {
    const input: CreateProcedureInput = {
      name: v.name.trim(),
      description: v.description.trim() || undefined,
      priceMinCents: toCents(v.priceMin),
      priceMaxCents: toCents(v.priceMax),
      durationMinutes: toInt(v.duration),
      active: v.active,
      offerText: v.offerText.trim() || undefined,
      offerMediaUrl: v.offerMediaUrl.trim() || undefined,
      offerMediaType: v.offerMediaType ?? undefined,
      tagIds: v.tagIds,
    };
    const onDone = { onSuccess: onClose };
    if (isEdit) update.mutate({ id: procedure.id, input }, onDone);
    else create.mutate(input, onDone);
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar procedimento" : "Novo procedimento"}</DialogTitle>
          <DialogDescription>
            Preços e duração são opcionais — o bot só cita o que estiver preenchido.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="proc-name" className="mb-2 text-[13px]">Nome</Label>
            <Input id="proc-name" {...register("name", { required: true })} placeholder="Ex.: Atendimento de avaliação" autoFocus />
          </div>
          <div>
            <Label htmlFor="proc-description" className="mb-2 text-[13px]">Descrição</Label>
            <Textarea id="proc-description" rows={2} {...register("description")} placeholder="O que está incluído, indicações…" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="proc-price-min" className="mb-2 text-[13px]">Preço mín. (R$)</Label>
              <Input id="proc-price-min" type="number" min={0} step="0.01" {...register("priceMin")} placeholder="1500" />
            </div>
            <div>
              <Label htmlFor="proc-price-max" className="mb-2 text-[13px]">Preço máx. (R$)</Label>
              <Input id="proc-price-max" type="number" min={0} step="0.01" {...register("priceMax")} placeholder="3500" />
            </div>
            <div>
              <Label htmlFor="proc-duration" className="mb-2 text-[13px]">Duração (min)</Label>
              <Input id="proc-duration" type="number" min={0} step="5" {...register("duration")} placeholder="90" />
            </div>
          </div>

          <div role="group" aria-label="Tags de interesse">
            <Label className="mb-2 text-[13px]">Tags de interesse</Label>
            {allTags.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                Nenhuma tag ainda — crie tags na aba “Tags” para associá-las aqui.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((t) => {
                  const on = tagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleTag(t.id)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                        on
                          ? "border-transparent"
                          : "border-border text-muted-foreground hover:border-foreground/30",
                      )}
                      style={
                        on
                          ? { background: `var(--tag-${t.color}-bg)`, color: `var(--tag-${t.color}-fg)` }
                          : undefined
                      }
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              Ajudam o agente a sugerir este procedimento conforme o interesse do cliente.
            </p>
          </div>

          <div>
            <Label htmlFor="proc-offer-text" className="mb-2 text-[13px]">
              Oferta especial (opcional)
            </Label>
            <Textarea
              id="proc-offer-text"
              rows={2}
              {...register("offerText")}
              placeholder="Ex.: 10% de desconto à vista neste mês."
            />
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              O agente apresenta esta oferta quando o cliente se interessa por este procedimento
              (ou por uma das suas tags).
            </p>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_170px] gap-3 max-[420px]:grid-cols-1">
            <div>
              <Label htmlFor="proc-offer-media" className="mb-2 text-[13px]">
                Mídia da oferta
              </Label>
              <Input
                id="proc-offer-media"
                type="url"
                {...register("offerMediaUrl")}
                placeholder="https://…/catalogo.pdf"
              />
              {/* Enviar o arquivo preenche URL e tipo; colar uma URL pública
                  continua funcionando para quem já hospeda a imagem. */}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <MediaUploadButton
                  purpose="oferta"
                  onUploaded={(result) => {
                    setValue("offerMediaUrl", result.url, { shouldDirty: true });
                    setValue("offerMediaType", result.type, {
                      shouldDirty: true,
                    });
                  }}
                />
                <span className="text-[12px] text-muted-foreground">
                  {acceptedFormatsLabel("oferta")}.
                </span>
              </div>
            </div>
            <div>
              <Label className="mb-2 text-[13px]">Tipo</Label>
              <Select
                value={offerMediaType ?? "none"}
                onValueChange={(v) =>
                  setValue("offerMediaType", v === "none" ? null : (v as MediaType))
                }
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
            </div>
          </div>

          <label className="flex items-center justify-between rounded-[var(--radius-md)] bg-muted px-3.5 py-2.5">
            <span className="text-[13.5px] font-medium">Ativo no catálogo</span>
            <Switch checked={active} onCheckedChange={(v) => setValue("active", v)} />
          </label>

          {(create.isError || update.isError) && (
            <p role="alert" className="text-[12.5px] text-destructive">
              Não foi possível salvar. Confira os campos e tente novamente.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Estado vazio reutilizado pelas abas de catálogo. */
export function EmptyState({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-primary-tint text-primary">
        {icon}
      </span>
      <div className="text-sm font-semibold">{title}</div>
      <p className="max-w-sm text-[13px] text-muted-foreground">{desc}</p>
    </div>
  );
}
