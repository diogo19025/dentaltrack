"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { CreateProcedureInput, ProcedureDto } from "@dentaltrack/shared";
import { Pencil, Plus, Stethoscope, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateProcedure,
  useDeleteProcedure,
  useProcedures,
  useUpdateProcedure,
} from "@/hooks/use-procedures";

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

/**
 * Aba "Procedimentos" das Configurações (BE-2.2 no FE). Sem mockup no handoff —
 * construída com o design system existente (Card + Table + Dialog), conforme
 * o plan.md §6. CRUD via TanStack Query contra `/procedures`.
 */
export function ProceduresTab() {
  const { data: procedures = [], isLoading } = useProcedures();
  const del = useDeleteProcedure();
  const [editing, setEditing] = useState<ProcedureDto | null | undefined>(undefined);

  function remove(p: ProcedureDto) {
    if (confirm(`Remover o procedimento "${p.name}"?`)) del.mutate(p.id);
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
          icon={<Stethoscope className="size-5" />}
          title="Nenhum procedimento cadastrado"
          desc="Adicione os tratamentos da clínica para o bot poder sugeri-los e informar valores."
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
          onClose={() => setEditing(undefined)}
        />
      )}
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
}

/** Dialog de criar/editar procedimento. Preços em reais (convertidos p/ centavos). */
function ProcedureDialog({
  procedure,
  onClose,
}: {
  procedure: ProcedureDto | null;
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
    },
  });
  const active = useWatch({ control, name: "active" });

  const toCents = (s: string) => (s.trim() === "" ? undefined : Math.round(Number(s) * 100));
  const toInt = (s: string) => (s.trim() === "" ? undefined : Math.round(Number(s)));

  const onSubmit = handleSubmit((v) => {
    const input: CreateProcedureInput = {
      name: v.name.trim(),
      description: v.description.trim() || undefined,
      priceMinCents: toCents(v.priceMin),
      priceMaxCents: toCents(v.priceMax),
      durationMinutes: toInt(v.duration),
      active: v.active,
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
            <Label className="mb-2 text-[13px]">Nome</Label>
            <Input {...register("name", { required: true })} placeholder="Ex.: Implante dentário" autoFocus />
          </div>
          <div>
            <Label className="mb-2 text-[13px]">Descrição</Label>
            <Textarea rows={2} {...register("description")} placeholder="O que está incluído, indicações…" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="mb-2 text-[13px]">Preço mín. (R$)</Label>
              <Input type="number" min={0} step="0.01" {...register("priceMin")} placeholder="1500" />
            </div>
            <div>
              <Label className="mb-2 text-[13px]">Preço máx. (R$)</Label>
              <Input type="number" min={0} step="0.01" {...register("priceMax")} placeholder="3500" />
            </div>
            <div>
              <Label className="mb-2 text-[13px]">Duração (min)</Label>
              <Input type="number" min={0} step="5" {...register("duration")} placeholder="90" />
            </div>
          </div>
          <label className="flex items-center justify-between rounded-[var(--radius-md)] bg-muted px-3.5 py-2.5">
            <span className="text-[13.5px] font-medium">Ativo no catálogo</span>
            <Switch checked={active} onCheckedChange={(v) => setValue("active", v)} />
          </label>

          {(create.isError || update.isError) && (
            <p className="text-[12.5px] text-destructive">
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
