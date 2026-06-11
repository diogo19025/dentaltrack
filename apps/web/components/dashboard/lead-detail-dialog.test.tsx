import { render, screen } from "@testing-library/react";
import type { LeadDetail } from "@dentaltrack/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLeadDetail } from "@/hooks/use-leads";
import { LeadDetailDialog } from "./lead-detail-dialog";

vi.mock("@/hooks/use-leads", () => ({ useLeadDetail: vi.fn() }));
const mockUseLeadDetail = vi.mocked(useLeadDetail);

type HookResult = ReturnType<typeof useLeadDetail>;
const hookResult = (partial: Partial<HookResult>) =>
  ({ data: undefined, isLoading: false, isError: false, ...partial }) as HookResult;

const makeDetail = (overrides: Partial<LeadDetail> = {}): LeadDetail => ({
  id: "00000000-0000-0000-0000-00000000a001",
  name: "João Silva",
  phone: "(11) 90000-0000",
  email: "joao@exemplo.com",
  interest: "Implante dentário",
  tags: [{ name: "implante", color: "teal" }],
  status: "agendada",
  source: "web",
  createdAt: "2026-06-09T10:00:00.000Z",
  score: 78,
  temperature: "quente",
  conversations: [
    {
      id: "00000000-0000-0000-0000-00000000c001",
      channel: "web",
      status: "agendada",
      messageCount: 9,
      lastMessageAt: "2026-06-11T10:00:00.000Z",
      createdAt: "2026-06-11T09:00:00.000Z",
      tags: [{ name: "implante", color: "teal" }],
    },
  ],
  appointments: [
    {
      id: "00000000-0000-0000-0000-00000000e001",
      procedure: "Implante dentário",
      preferredTime: "quinta de manhã",
      createdAt: "2026-06-11T10:00:00.000Z",
    },
  ],
  ...overrides,
});

describe("LeadDetailDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fechado (leadId null) não renderiza o painel", () => {
    mockUseLeadDetail.mockReturnValue(hookResult({}));
    render(<LeadDetailDialog leadId={null} onOpenChange={() => {}} />);

    expect(screen.queryByText("Detalhes do lead")).toBeNull();
  });

  it("carregando mostra o título e o estado de loading", () => {
    mockUseLeadDetail.mockReturnValue(hookResult({ isLoading: true }));
    render(<LeadDetailDialog leadId="lead-1" onOpenChange={() => {}} />);

    expect(screen.getByText("Detalhes do lead")).toBeInTheDocument();
    expect(screen.getByText("Carregando informações…")).toBeInTheDocument();
  });

  it("erro mostra alerta para tentar de novo", () => {
    mockUseLeadDetail.mockReturnValue(hookResult({ isError: true }));
    render(<LeadDetailDialog leadId="lead-1" onOpenChange={() => {}} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar o lead");
  });

  it("renderiza o detalhe completo: pílula de temperatura, contato, conversas e agendamentos", () => {
    mockUseLeadDetail.mockReturnValue(hookResult({ data: makeDetail() }));
    render(<LeadDetailDialog leadId="lead-1" onOpenChange={() => {}} />);

    expect(screen.getByText("João Silva")).toBeInTheDocument();
    expect(screen.getByText("Quente · 78")).toBeInTheDocument();
    expect(screen.getByText("(11) 90000-0000")).toBeInTheDocument();
    expect(screen.getByText("joao@exemplo.com")).toBeInTheDocument();
    expect(screen.getByText("Conversas (1)")).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument(); // pílula do canal
    expect(screen.getByText("9 mensagens")).toBeInTheDocument();
    expect(screen.getByText(/quinta de manhã/)).toBeInTheDocument();

    const wa = screen.getByRole("link", { name: /conversar no whatsapp/i });
    expect(wa).toHaveAttribute("href", "https://wa.me/5511900000000");
    expect(wa).toHaveAttribute("target", "_blank");
  });

  it("sem telefone mostra a dica e não mostra o link do WhatsApp", () => {
    mockUseLeadDetail.mockReturnValue(hookResult({ data: makeDetail({ phone: null }) }));
    render(<LeadDetailDialog leadId="lead-1" onOpenChange={() => {}} />);

    expect(screen.queryByRole("link", { name: /whatsapp/i })).toBeNull();
    expect(screen.getByText(/Sem telefone capturado/)).toBeInTheDocument();
  });

  it("lead sem conversas mostra o estado vazio da lista", () => {
    mockUseLeadDetail.mockReturnValue(
      hookResult({ data: makeDetail({ conversations: [], appointments: [] }) }),
    );
    render(<LeadDetailDialog leadId="lead-1" onOpenChange={() => {}} />);

    expect(screen.getByText("Conversas (0)")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma conversa registrada para este lead.")).toBeInTheDocument();
    expect(screen.queryByText(/Agendamentos/)).toBeNull();
  });
});
