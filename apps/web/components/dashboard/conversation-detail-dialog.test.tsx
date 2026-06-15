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
  messageCount: 2,
  contactPhone: "558387504242",
  tags: [
    { id: "00000000-0000-0000-0000-00000000e001", name: "implante", color: "teal", confidence: 0.9 },
  ],
  messages: [
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

  it("renderiza canal, status, tags, histórico e o botão do WhatsApp", () => {
    mockUseConversationDetail.mockReturnValue(hookResult({ data: makeDetail() }));
    render(<ConversationDetailDialog conversationId="c-1" onOpenChange={() => {}} />);

    expect(screen.getByText("WhatsApp")).toBeInTheDocument(); // pílula do canal
    expect(screen.getByText("implante")).toBeInTheDocument();
    expect(screen.getByText("Últimas mensagens (2)")).toBeInTheDocument();
    expect(screen.getByText("Quero agendar uma limpeza")).toBeInTheDocument();
    expect(screen.getByText("Claro! Posso te ajudar com isso.")).toBeInTheDocument();

    const wa = screen.getByRole("link", { name: /abrir conversa no whatsapp/i });
    expect(wa).toHaveAttribute("href", "https://wa.me/558387504242");
    expect(wa).toHaveAttribute("target", "_blank");
  });

  it("sem tags mostra o aviso de que ainda não há tags", () => {
    mockUseConversationDetail.mockReturnValue(hookResult({ data: makeDetail({ tags: [] }) }));
    render(<ConversationDetailDialog conversationId="c-1" onOpenChange={() => {}} />);

    expect(screen.getByText("Tags detectadas")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma tag detectada ainda.")).toBeInTheDocument();
  });

  it("sem telefone esconde o botão e mostra a dica", () => {
    mockUseConversationDetail.mockReturnValue(hookResult({ data: makeDetail({ contactPhone: null }) }));
    render(<ConversationDetailDialog conversationId="c-1" onOpenChange={() => {}} />);

    expect(screen.queryByRole("link", { name: /whatsapp/i })).toBeNull();
    expect(screen.getByText(/Sem telefone do contato/)).toBeInTheDocument();
  });

  it("quando há mais mensagens que o limite, mostra o aviso de truncamento", () => {
    mockUseConversationDetail.mockReturnValue(
      hookResult({ data: makeDetail({ messageCount: 42 }) }),
    );
    render(<ConversationDetailDialog conversationId="c-1" onOpenChange={() => {}} />);

    expect(screen.getByText("Mostrando as últimas 2 de 42 mensagens.")).toBeInTheDocument();
  });

  it("conversa sem mensagens mostra o estado vazio", () => {
    mockUseConversationDetail.mockReturnValue(
      hookResult({ data: makeDetail({ messages: [], messageCount: 0, tags: [] }) }),
    );
    render(<ConversationDetailDialog conversationId="c-1" onOpenChange={() => {}} />);

    expect(screen.getByText("Últimas mensagens (0)")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma mensagem registrada nesta conversa.")).toBeInTheDocument();
  });
});
