"use client";

import type { DragEvent } from "react";
import type { PipelineCardDto, PipelineStageDto } from "@dentaltrack/shared";
import { ArrowRightLeft, Hand, MoreHorizontal, Phone, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials, sourceLabel, timeAgo } from "@/lib/format";
import { stageMeta } from "@/lib/funnel";

/** Tipo MIME custom do drag-and-drop nativo do board. */
export const CARD_DRAG_TYPE = "application/x-dentaltrack-card";

/**
 * Card de um contato no board do funil (F7). Arrastável entre colunas
 * (drag-and-drop nativo) e com menu "Mover para" como caminho acessível por
 * teclado — as duas vias chamam o mesmo `onMove`. A lista de colunas vem do
 * servidor (colunas por clínica, incl. personalizadas).
 */
export function FunnelCard({
  card,
  stages,
  onMove,
  onRemove,
}: {
  card: PipelineCardDto;
  stages: PipelineStageDto[];
  onMove: (stageId: string) => void;
  onRemove: () => void;
}) {
  const title = card.name ?? card.phone ?? "Visitante";
  const activityAt = card.lastMessageAt ?? card.stageUpdatedAt;

  function onDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData(CARD_DRAG_TYPE, card.id);
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="lift cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing"
    >
      <div className="flex items-center gap-2.5">
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary-tint text-[12px] font-semibold text-primary">
            {initials(card.name, "?")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">{title}</div>
          <div className="truncate text-[12px] text-muted-foreground">
            {card.channel
              ? `${sourceLabel(card.channel)} · ${timeAgo(activityAt)}`
              : `Manual · ${timeAgo(activityAt)}`}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${title}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <ArrowRightLeft className="size-3.5" /> Mover para
            </DropdownMenuLabel>
            {stages
              .filter((s) => s.id !== card.stageId)
              .map((stage) => (
                <DropdownMenuItem key={stage.id} onSelect={() => onMove(stage.id)}>
                  <span
                    className="size-2 rounded-full"
                    style={{ background: stageMeta(stage).fg }}
                    aria-hidden="true"
                  />
                  {stage.name}
                </DropdownMenuItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2 className="size-3.5" /> Remover do funil
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {card.phone && (
        <div className="tabular mt-2 flex items-center gap-[7px] text-[12px] text-muted-foreground">
          <Phone className="size-3" />
          {card.phone}
        </div>
      )}
      {card.note && (
        <p className="mt-2 line-clamp-2 text-[12px] leading-[1.45] text-muted-foreground">
          {card.note}
        </p>
      )}
      {card.stageSource === "manual" && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-[3px] text-[11px] font-medium text-muted-foreground">
          <Hand className="size-3" aria-hidden="true" /> Posicionado manualmente
        </div>
      )}
    </div>
  );
}
