"use client";

import { useState } from "react";
import type { PipelineStageDto } from "@dentaltrack/shared";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePipelineCard } from "@/hooks/use-pipeline";

/**
 * Dialog "Adicionar cliente" do funil (F7): cliente que chegou fora do chatbot
 * (telefone, indicação, balcão). Cria um Lead `source=manual` + card na coluna
 * escolhida (colunas vêm do servidor, incl. as personalizadas).
 */
export function AddClientDialog({
  open,
  stages,
  onOpenChange,
}: {
  open: boolean;
  stages: PipelineStageDto[];
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [stageId, setStageId] = useState<string | undefined>(undefined);
  const create = useCreatePipelineCard();

  function reset() {
    setName("");
    setPhone("");
    setNote("");
    setStageId(undefined);
    create.reset();
  }

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  function submit() {
    create.mutate(
      {
        name: name.trim(),
        phone: phone.trim() || undefined,
        note: note.trim() || undefined,
        stageId: stageId ?? stages[0]?.id,
      },
      { onSuccess: () => close(false) },
    );
  }

  const valid = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar cliente ao funil</DialogTitle>
          <DialogDescription>
            Para contatos que chegaram fora do chatbot (telefone, indicação, balcão). Ele também
            entra na sua lista de leads.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="funnel-client-name">Nome</Label>
            <Input
              id="funnel-client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Maria Souza"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="funnel-client-phone">Telefone (opcional)</Label>
            <Input
              id="funnel-client-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ex.: (11) 99999-0000"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="funnel-client-stage">Coluna</Label>
            <Select
              value={stageId ?? stages[0]?.id}
              onValueChange={(v) => setStageId(v)}
            >
              <SelectTrigger id="funnel-client-stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="funnel-client-note">Observação (opcional)</Label>
            <Textarea
              id="funnel-client-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: Ligou pedindo um orçamento."
            />
          </div>
          {create.isError && (
            <p role="alert" className="text-[13px] text-destructive">
              Não foi possível adicionar o cliente. Tente novamente.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!valid || create.isPending}>
            {create.isPending ? "Adicionando…" : "Adicionar cliente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
