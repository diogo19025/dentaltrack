import type { MetaConnection } from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsappProviderCard } from "./whatsapp-provider-card";

const state = vi.hoisted(() => ({
  data: null as MetaConnection | null,
  setProvider: vi.fn(),
}));

vi.mock("@/hooks/use-meta-connection", () => ({
  useMetaConnection: () => ({
    data: state.data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSetWhatsappProvider: () => ({
    mutate: state.setProvider,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const base: MetaConnection = {
  provider: "evolution",
  phoneNumberId: null,
  wabaId: null,
  tokenSaved: false,
  displayPhone: null,
  verifiedName: null,
  serverReady: true,
  webhookUrl: null,
};

afterEach(() => {
  vi.clearAllMocks();
  state.data = null;
});

describe("WhatsappProviderCard", () => {
  it("sem credencial da Meta salva: explica e não troca", () => {
    state.data = base;
    render(<WhatsappProviderCard />);

    fireEvent.click(screen.getByRole("tab", { name: "API oficial da Meta" }));

    expect(screen.getByRole("alert").textContent).toMatch(/Salve as credenciais/);
    expect(state.setProvider).not.toHaveBeenCalled();
  });

  it("com credencial salva: ativa a Meta, e volta ao QR code sem apagar nada", () => {
    state.data = { ...base, tokenSaved: true, phoneNumberId: "1055" };
    render(<WhatsappProviderCard />);

    fireEvent.click(screen.getByRole("tab", { name: "API oficial da Meta" }));
    expect(state.setProvider).toHaveBeenCalledWith("meta");

    state.data = { ...state.data, provider: "meta" };
    render(<WhatsappProviderCard />);
    fireEvent.click(
      screen.getAllByRole("tab", { name: "Número pareado por QR code" })[1],
    );
    expect(state.setProvider).toHaveBeenCalledWith("evolution");
  });

  it("clicar no provedor já ativo não chama a API", () => {
    state.data = base;
    render(<WhatsappProviderCard />);

    fireEvent.click(
      screen.getByRole("tab", { name: "Número pareado por QR code" }),
    );
    expect(state.setProvider).not.toHaveBeenCalled();
  });
});
