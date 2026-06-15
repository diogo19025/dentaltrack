import { render, screen } from "@testing-library/react";
import type { ConversationDetail } from "@dentaltrack/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationDetail } from "@/hooks/use-conversations";
import { ConversationDetailDialog } from "./conversation-detail-dialog";

vi.mock("@/hooks/use-conversations", () => ({ useConversationDetail: vi.fn() }));
const mockUseConversationDetail = vi.mocked(useConversationDetail);

type HookResult = ReturnType<typeof useConversationDetail>;
const hookResult = (partial: Partial<HookResult>) =>
  ({ data: undefined, isLoading: false, isError: false, ...partial }) as HookResult;

const makeDetail = (overrides: Partial<ConversationDetail> = {}): ConversationDetail => ({
  id: "00000000-0000-0000-0000-00000000c001",
  status: "agendada",
  channel: "whatsapp",
  createdAt: "2026-06-11T09:00:00.000Z",
  messageCount: 3,
  tags: [
    { id: "00000000-0000-0000-0000-00000000e001", name: "implante", color: "teal", confidence: 0.9 },
  ],
  messages: [
    { id: "m1", role: "system", content: "prompt interno", createdAt: "2026-06-11T09:00:00.000Z" },
    { id: "m2", role: "user", content: "Quero agendar uma limpeza", createdAt: "2026-06-11T09:01:00.000Z" },
    { id: "m3", role: "assistant", content: "Claro! Posso te ajudar com isso.", createdAt: "2026-06-11T09:02:00.000Z" },
  ],
  ...overrides,
});

describe("ConversationDetailDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fechado (conversationId null) não renderiza o painel", () => {
    mockUseConversationDetail.mockReturnValue(hookResult({}));
    render(<ConversationDetailDialog conversationId={null} onOpenChange={() => {}} />);

    expect(screen.queryByText("Detalhes da conversa")).toBeNull();
  });

  it("carregando mostra o título e o estado de loading", () => {
    mockUseConversationDetail.mockReturnValue(hookResult({ isLoading: true }));
    render(<ConversationDetailDialog conversationId="c-1" onOpenChange={() => {}} />);

    expect(screen.getByText("Detalhes da conversa")).toBeInTheDocument();
    expect(screen.getByText("Carregando mensagens…")).toBeInTheDocument();
  });

  it("erro mostra alerta para tentar de novo", () => {
    mockUseConversationDetail.mockReturnValue(hookResult({ isError: true }));
    render(<ConversationDetailDialog conversationId="c-1" onOpenChange={() => {}} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar a conversa");
  });

  it("renderiza canal, status, tags e o histórico (sem mensagens de sistema)", () => {
    mockUseConversationDetail.mockReturnValue(hookResult({ data: makeDetail() }));
    render(<ConversationDetailDialog conversationId="c-1" onOpenChange={() => {}} />);

    expect(screen.getByText("WhatsApp")).toBeInTheDocument(); // pílula do canal
    expect(screen.getByText("implante")).toBeInTheDocument();
    // system filtrada → só 2 mensagens (user + assistant)
    expect(screen.getByText("Histórico (2)")).toBeInTheDocument();
    expect(screen.getByText("Quero agendar uma limpeza")).toBeInTheDocument();
    expect(screen.getByText("Claro! Posso te ajudar com isso.")).toBeInTheDocument();
    expect(screen.queryByText("prompt interno")).toBeNull();
  });

  it("conversa sem mensagens mostra o estado vazio", () => {
    mockUseConversationDetail.mockReturnValue(
      hookResult({ data: makeDetail({ messages: [], messageCount: 0, tags: [] }) }),
    );
    render(<ConversationDetailDialog conversationId="c-1" onOpenChange={() => {}} />);

    expect(screen.getByText("Histórico (0)")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma mensagem registrada nesta conversa.")).toBeInTheDocument();
  });
});
