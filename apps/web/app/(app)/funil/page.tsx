"use client";

import { useMemo, useState, type DragEvent } from "react";
import type { PipelineCardDto, PipelineStageDto } from "@dentaltrack/shared";
import { MAX_PIPELINE_STAGES } from "@dentaltrack/shared";
import { MoreHorizontal, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { AddClientDialog } from "@/components/funnel/add-client-dialog";
import { CARD_DRAG_TYPE, FunnelCard } from "@/components/funnel/funnel-card";
import { StageNameDialog } from "@/components/funnel/stage-name-dialog";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreatePipelineStage,
  useDeletePipelineCard,
  useDeletePipelineStage,
  useMovePipelineCard,
  usePipeline,
  useRenamePipelineStage,
} from "@/hooks/use-pipeline";
import { stageMeta } from "@/lib/funnel";
import { cn } from "@/lib/utils";

/**
 * Funil de atendimento (F7) — board kanban dos contatos por estágio da
 * conversa. Os cards nascem das conversas do bot e **andam sozinhos** conforme
 * o detector automático avança o estágio (a query faz polling); o dono move
 * qualquer card à mão (drag-and-drop ou menu), adiciona clientes manualmente e
 * gerencia as colunas (criar/renomear/excluir — as padrão só renomeiam).
 */
export default function FunnelPage() {
  const { data, isLoading } = usePipeline();
  const move = useMovePipelineCard();
  const removeCard = useDeletePipelineCard();
  const createStage = useCreatePipelineStage();
  const renameStage = useRenamePipelineStage();
  const deleteStage = useDeletePipelineStage();

  const [addOpen, setAddOpen] = useState(false);
  const [newStageOpen, setNewStageOpen] = useState(false);
  const [renaming, setRenaming] = useState<PipelineStageDto | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const stages = useMemo(
    () => [...(data?.stages ?? [])].sort((a, b) => a.position - b.position),
    [data],
  );
  const byStage = useMemo(() => {
    const map = new Map<string, PipelineCardDto[]>(stages.map((s) => [s.id, []]));
    for (const card of data?.cards ?? []) map.get(card.stageId)?.push(card);
    return map;
  }, [data, stages]);

  function onDrop(e: DragEvent<HTMLElement>, stageId: string) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData(CARD_DRAG_TYPE);
    const card = data?.cards.find((c) => c.id === id);
    if (card && card.stageId !== stageId) move.mutate({ id, stageId });
  }

  const canAddStage = stages.length < MAX_PIPELINE_STAGES;

  return (
    <>
      <PageHeader
        title="Funil de atendimento"
        subtitle="Contatos organizados pelo estágio da conversa — o agente move os cards automaticamente."
      >
        <Button
          variant="secondary"
          onClick={() => setNewStageOpen(true)}
          disabled={isLoading || !canAddStage}
          title={canAddStage ? undefined : `Limite de ${MAX_PIPELINE_STAGES} colunas atingido`}
        >
          <Plus className="size-4" /> Nova coluna
        </Button>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus className="size-4" /> Adicionar cliente
        </Button>
      </PageHeader>

      {isLoading ? (
        <div className="grid grid-cols-5 gap-[14px] max-[1280px]:grid-cols-3 max-[860px]:grid-cols-2 max-[560px]:grid-cols-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[220px] w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-5 items-start gap-[14px] max-[1280px]:grid-cols-3 max-[860px]:grid-cols-2 max-[560px]:grid-cols-1">
          {stages.map((stage) => {
            const meta = stageMeta(stage);
            const cards = byStage.get(stage.id) ?? [];
            return (
              <section
                key={stage.id}
                aria-label={`${stage.name}: ${cards.length}`}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(CARD_DRAG_TYPE)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOver(stage.id);
                }}
                onDragLeave={() => setDragOver((s) => (s === stage.id ? null : s))}
                onDrop={(e) => onDrop(e, stage.id)}
                className={cn(
                  "rounded-lg border border-border bg-secondary/50 p-2.5 transition-colors",
                  dragOver === stage.id && "border-primary bg-primary-tint",
                )}
              >
                <div className="flex items-center gap-2 px-1 pb-0.5 pt-0.5">
                  <span
                    className="size-2 flex-none rounded-full"
                    style={{ background: meta.fg }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate text-[13px] font-semibold">{stage.name}</span>
                  <span
                    className="tabular ml-auto rounded-full px-2 py-[2px] text-[12px] font-semibold"
                    style={{ background: meta.bg, color: meta.fg }}
                  >
                    {cards.length}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="-mr-1"
                        aria-label={`Ações da coluna ${stage.name}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRenaming(stage)}>
                        <Pencil className="size-3.5" /> Renomear
                      </DropdownMenuItem>
                      {!stage.systemStage && (
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => deleteStage.mutate(stage.id)}
                        >
                          <Trash2 className="size-3.5" /> Excluir coluna
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="px-1 pb-2 text-[12px] text-muted-foreground">{meta.hint}</div>

                <div className="flex min-h-[64px] flex-col gap-2.5">
                  {cards.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12.5px] text-muted-foreground">
                      Nenhum contato aqui.
                    </p>
                  ) : (
                    cards.map((card) => (
                      <FunnelCard
                        key={card.id}
                        card={card}
                        stages={stages}
                        onMove={(stageId) => move.mutate({ id: card.id, stageId })}
                        onRemove={() => removeCard.mutate(card.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <AddClientDialog open={addOpen} stages={stages} onOpenChange={setAddOpen} />

      <StageNameDialog
        open={newStageOpen}
        title="Nova coluna"
        description="A coluna entra no fim do board. Cards chegam nela por movimento manual (o agente só usa as colunas padrão)."
        submitLabel="Criar coluna"
        isPending={createStage.isPending}
        isError={createStage.isError}
        onOpenChange={(open) => {
          setNewStageOpen(open);
          if (!open) createStage.reset();
        }}
        onSubmit={(name) =>
          createStage.mutate({ name }, { onSuccess: () => setNewStageOpen(false) })
        }
      />

      <StageNameDialog
        open={renaming !== null}
        title="Renomear coluna"
        description={
          renaming?.systemStage
            ? "Coluna padrão do funil: o nome muda, mas o agente continua movendo os cards para ela normalmente."
            : "Renomeie a coluna personalizada."
        }
        initialName={renaming?.name ?? ""}
        submitLabel="Salvar"
        isPending={renameStage.isPending}
        isError={renameStage.isError}
        onOpenChange={(open) => {
          if (!open) {
            setRenaming(null);
            renameStage.reset();
          }
        }}
        onSubmit={(name) => {
          if (!renaming) return;
          renameStage.mutate(
            { id: renaming.id, name },
            { onSuccess: () => setRenaming(null) },
          );
        }}
      />
    </>
  );
}
