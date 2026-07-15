"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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

/**
 * Dialog de nome de coluna do funil (F7): serve para **criar** uma coluna
 * personalizada e para **renomear** uma existente (inclusive as padrão).
 */
export function StageNameDialog({
  open,
  title,
  description,
  initialName = "",
  submitLabel,
  isPending,
  isError,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  initialName?: string;
  submitLabel: string;
  isPending: boolean;
  isError: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  // Derivado no render (sem setState-em-efeito): mostra o nome atual da
  // coluna até o usuário editar; fechar zera a edição p/ a próxima abertura.
  const [edited, setEdited] = useState<string | null>(null);
  const name = edited ?? initialName;

  function close(next: boolean) {
    if (!next) setEdited(null);
    onOpenChange(next);
  }

  const valid = name.trim().length > 0 && name.trim().length <= 40;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="funnel-stage-name">Nome da coluna</Label>
          <Input
            id="funnel-stage-name"
            value={name}
            maxLength={40}
            onChange={(e) => setEdited(e.target.value)}
            placeholder="Ex.: Pós-venda"
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid && !isPending) onSubmit(name.trim());
            }}
          />
          {isError && (
            <p role="alert" className="text-[13px] text-destructive">
              Não foi possível salvar. Verifique se já não existe uma coluna com esse nome.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button disabled={!valid || isPending} onClick={() => onSubmit(name.trim())}>
            {isPending ? "Salvando…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
