"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { type CreateTagInput, TAG_COLORS, type TagColor, type TagDto } from "@dentaltrack/shared";
import { Pencil, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useCreateTag, useDeleteTag, useTags, useUpdateTag } from "@/hooks/use-tags";
import { EmptyState } from "./procedures-tab";

/** Pílula colorida de uma tag (cor explícita do registro). */
function TagPill({ name, color }: { name: string; color: TagColor }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: `var(--tag-${color}-bg)`, color: `var(--tag-${color}-fg)` }}
    >
      {name}
    </span>
  );
}

/**
 * Aba "Tags" das Configurações (BE-2.3 no FE). As `keywords` são os gatilhos do
 * auto-tagging (F3). Sem mockup — design system existente (plan.md §6).
 */
export function TagsTab() {
  const { data: tags = [], isLoading } = useTags();
  const del = useDeleteTag();
  const [editing, setEditing] = useState<TagDto | null | undefined>(undefined);

  function remove(t: TagDto) {
    if (confirm(`Remover a tag "${t.name}"?`)) del.mutate(t.id);
  }

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center justify-between border-b border-border px-6 py-[18px]">
        <div>
          <div className="text-base font-semibold tracking-[-0.01em]">Tags de interesse</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            Classificam as conversas por interesse. As palavras-chave acionam a marcação automática.
          </div>
        </div>
        <Button type="button" onClick={() => setEditing(null)}>
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>

      {isLoading ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : tags.length === 0 ? (
        <EmptyState
          icon={<TagIcon className="size-5" />}
          title="Nenhuma tag cadastrada"
          desc="Crie tags de interesse (ex.: orçamento, agendamento) com palavras-chave para classificar as conversas."
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[12.5px] text-muted-foreground">
              <th className="px-6 py-2.5 font-medium">Tag</th>
              <th className="px-3 py-2.5 font-medium">Categoria</th>
              <th className="px-3 py-2.5 font-medium">Palavras-chave</th>
              <th className="px-6 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {tags.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0 hover:bg-accent">
                <td className="px-6 py-3">
                  <TagPill name={t.name} color={t.color} />
                </td>
                <td className="px-3 py-3 text-muted-foreground">{t.category || "—"}</td>
                <td className="px-3 py-3">
                  {t.keywords.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {t.keywords.map((k) => (
                        <span
                          key={k}
                          className="rounded-md bg-muted px-2 py-0.5 text-[12px] text-muted-foreground"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-6 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Editar" onClick={() => setEditing(t)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remover"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => remove(t)}
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
        <TagDialog key={editing?.id ?? "new"} tag={editing} onClose={() => setEditing(undefined)} />
      )}
    </Card>
  );
}

interface TagForm {
  name: string;
  color: TagColor;
  category: string;
  keywords: string;
}

/** Dialog de criar/editar tag (cor por swatch; keywords separadas por vírgula). */
function TagDialog({ tag, onClose }: { tag: TagDto | null; onClose: () => void }) {
  const create = useCreateTag();
  const update = useUpdateTag();
  const isEdit = tag != null;
  const pending = create.isPending || update.isPending;

  const { register, handleSubmit, control, setValue } = useForm<TagForm>({
    defaultValues: {
      name: tag?.name ?? "",
      color: tag?.color ?? "teal",
      category: tag?.category ?? "",
      keywords: tag?.keywords.join(", ") ?? "",
    },
  });
  const color = useWatch({ control, name: "color" });

  const onSubmit = handleSubmit((v) => {
    const input: CreateTagInput = {
      name: v.name.trim(),
      color: v.color,
      category: v.category.trim() || undefined,
      keywords: v.keywords
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0),
    };
    const onDone = { onSuccess: onClose };
    if (isEdit) update.mutate({ id: tag.id, input }, onDone);
    else create.mutate(input, onDone);
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar tag" : "Nova tag"}</DialogTitle>
          <DialogDescription>
            As palavras-chave são os gatilhos que marcam a conversa automaticamente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tag-name" className="mb-2 text-[13px]">Nome</Label>
              <Input id="tag-name" {...register("name", { required: true })} placeholder="Ex.: orçamento" autoFocus />
            </div>
            <div>
              <Label htmlFor="tag-category" className="mb-2 text-[13px]">Categoria</Label>
              <Input id="tag-category" {...register("category")} placeholder="Ex.: Procedimento" />
            </div>
          </div>

          <div role="group" aria-label="Cor da tag">
            <Label className="mb-2 text-[13px]">Cor</Label>
            <div className="flex gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={color === c}
                  onClick={() => setValue("color", c)}
                  className={cn(
                    "size-7 rounded-full ring-2 ring-offset-2 ring-offset-background transition-all",
                    color === c ? "ring-foreground/40" : "ring-transparent hover:ring-border",
                  )}
                  style={{ background: `var(--tag-${c}-bg)` }}
                >
                  <span
                    className="mx-auto block size-2.5 rounded-full"
                    style={{ background: `var(--tag-${c}-fg)` }}
                  />
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="tag-keywords" className="mb-2 text-[13px]">Palavras-chave</Label>
            <Input id="tag-keywords" {...register("keywords")} placeholder="orçamento, valor, preço, quanto custa" />
            <p className="mt-1.5 text-[12px] text-muted-foreground">Separe por vírgula.</p>
          </div>

          {(create.isError || update.isError) && (
            <p role="alert" className="text-[12.5px] text-destructive">
              Não foi possível salvar. Talvez já exista uma tag com esse nome.
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
