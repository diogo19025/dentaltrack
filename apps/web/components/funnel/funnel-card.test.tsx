import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PipelineCardDto, PipelineStageDto } from "@dentaltrack/shared";
import { describe, expect, it, vi } from "vitest";
import { FunnelCard } from "./funnel-card";

const STAGES: PipelineStageDto[] = [
  { id: "33333333-3333-3333-3333-333333333331", name: "Novo contato", position: 0, systemStage: "novo_contato" },
  { id: "33333333-3333-3333-3333-333333333333", name: "Quero agendar", position: 2, systemStage: "quero_agendar" },
  { id: "33333333-3333-3333-3333-333333333334", name: "Escolha de data", position: 3, systemStage: "escolha_data" },
  { id: "33333333-3333-3333-3333-333333333335", name: "Pós-venda", position: 5, systemStage: null },
];

function card(overrides: Partial<PipelineCardDto> = {}): PipelineCardDto {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    stageId: STAGES[1].id,
    source: "auto",
    stageSource: "auto",
    name: "João Silva",
    phone: "11 99999-0000",
    channel: "whatsapp",
    conversationId: "22222222-2222-2222-2222-222222222222",
    leadId: null,
    status: "em_andamento",
    note: null,
    lastMessageAt: new Date().toISOString(),
    stageUpdatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("FunnelCard", () => {
  it("mostra nome, telefone e canal do contato", () => {
    render(<FunnelCard card={card()} stages={STAGES} onOpen={vi.fn()} onMove={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText("João Silva")).toBeInTheDocument();
    expect(screen.getByText("11 99999-0000")).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp/)).toBeInTheDocument();
  });

  it("clicar no card abre o detalhe (onOpen); clicar no menu não", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<FunnelCard card={card()} stages={STAGES} onOpen={onOpen} onMove={vi.fn()} onRemove={vi.fn()} />);

    await user.click(screen.getByText("João Silva"));
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Abrir o menu de ações não deve disparar o detalhe do card.
    await user.click(screen.getByRole("button", { name: /Ações de João Silva/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("card manual sem conversa mostra a origem Manual e a nota", () => {
    render(
      <FunnelCard
        card={card({ channel: null, source: "manual", note: "Ligou pedindo orçamento" })}
        stages={STAGES}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText(/Manual/)).toBeInTheDocument();
    expect(screen.getByText("Ligou pedindo orçamento")).toBeInTheDocument();
  });

  it('badge "Posicionado manualmente" só aparece quando o último movimento foi do dono', () => {
    const { rerender } = render(
      <FunnelCard card={card()} stages={STAGES} onOpen={vi.fn()} onMove={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByText("Posicionado manualmente")).not.toBeInTheDocument();

    rerender(
      <FunnelCard
        card={card({ stageSource: "manual" })}
        stages={STAGES}
        onOpen={vi.fn()}
        onMove={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("Posicionado manualmente")).toBeInTheDocument();
  });

  it('menu "Mover para" lista as demais colunas (inclusive personalizadas) e chama onMove', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(<FunnelCard card={card()} stages={STAGES} onOpen={vi.fn()} onMove={onMove} onRemove={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Ações de João Silva/ }));
    // A coluna atual (Quero agendar) fica de fora do menu.
    expect(screen.queryByRole("menuitem", { name: /Quero agendar/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Pós-venda/ })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Escolha de data/ }));

    expect(onMove).toHaveBeenCalledWith(STAGES[2].id);
  });

  it('menu tem "Remover do funil" chamando onRemove', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<FunnelCard card={card()} stages={STAGES} onOpen={vi.fn()} onMove={vi.fn()} onRemove={onRemove} />);

    await user.click(screen.getByRole("button", { name: /Ações de João Silva/ }));
    await user.click(screen.getByRole("menuitem", { name: /Remover do funil/ }));

    expect(onRemove).toHaveBeenCalled();
  });
});
