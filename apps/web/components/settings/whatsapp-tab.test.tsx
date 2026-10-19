import type { WhatsappConnection } from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsappTab } from "./whatsapp-tab";

const state = vi.hoisted(() => ({
  data: null as WhatsappConnection | null,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/use-whatsapp-connection", () => ({
  useWhatsappConnection: () => ({
    data: state.data,
    isLoading: state.data === null && state.error === null,
    isError: state.error !== null,
    error: state.error,
    refetch: state.refetch,
  }),
}));

vi.mock("@/components/settings/meta-card", () => ({
  MetaCard: () => <div>Cartão da Meta</div>,
}));

vi.mock("@/components/settings/whatsapp-provider-card", () => ({
  WhatsappProviderCard: () => <div>Provedor ativo</div>,
}));

vi.mock("@/components/whatsapp/connect-panel", () => ({
  WhatsappConnectPanel: () => <div>Painel de conexão</div>,
}));

afterEach(() => {
  vi.clearAllMocks();
  state.data = null;
  state.error = null;
});

describe("WhatsappTab", () => {
  it("mostra a falha da consulta em vez de um skeleton eterno", () => {
    state.error = new Error("WhatsApp indisponível");
    render(<WhatsappTab />);

    // Um cartão por número (principal e avisos), cada um com a sua falha.
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent("WhatsApp indisponível");
    fireEvent.click(
      screen.getAllByRole("button", { name: /tentar de novo/i })[0],
    );
    expect(state.refetch).toHaveBeenCalledOnce();
  });
});
