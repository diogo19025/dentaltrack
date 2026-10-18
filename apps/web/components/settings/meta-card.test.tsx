import type { MetaConnection } from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaCard } from "./meta-card";

const state = vi.hoisted(() => ({
  data: null as MetaConnection | null,
  save: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/hooks/use-meta-connection", () => ({
  useMetaConnection: () => ({
    data: state.data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSaveMetaCredentials: () => ({
    mutate: state.save,
    isPending: false,
    isError: false,
    error: null,
  }),
  useRemoveMetaCredentials: () => ({
    mutate: state.remove,
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
  webhookUrl: "https://api.exemplo.com/whatsapp/meta/webhook",
};

afterEach(() => {
  vi.clearAllMocks();
  state.data = null;
});

function fill(phone: string, waba: string, token: string) {
  fireEvent.change(screen.getByLabelText("ID do número"), {
    target: { value: phone },
  });
  fireEvent.change(screen.getByLabelText(/ID da conta WhatsApp Business/), {
    target: { value: waba },
  });
  fireEvent.change(screen.getByLabelText(/Token de acesso/), {
    target: { value: token },
  });
}

describe("MetaCard", () => {
  it("mostra a URL do webhook para cadastrar no app da Meta", () => {
    state.data = base;
    render(<MetaCard />);

    expect(
      screen.getByText("https://api.exemplo.com/whatsapp/meta/webhook"),
    ).toBeTruthy();
    expect(screen.getByText("Desligada")).toBeTruthy();
  });

  it("campo inválido: mostra o erro e não chama a API", () => {
    state.data = base;
    render(<MetaCard />);

    fill("abc", "2077", "x".repeat(30));
    fireEvent.click(
      screen.getByRole("button", { name: /Validar e usar a API oficial/ }),
    );

    expect(screen.getByRole("alert").textContent).toMatch(/dígitos/);
    expect(state.save).not.toHaveBeenCalled();
  });

  it("campos válidos: envia as credenciais", () => {
    state.data = base;
    render(<MetaCard />);

    fill("1055123", "2077123", "EAA" + "x".repeat(30));
    fireEvent.click(
      screen.getByRole("button", { name: /Validar e usar a API oficial/ }),
    );

    expect(state.save).toHaveBeenCalledWith(
      {
        phoneNumberId: "1055123",
        wabaId: "2077123",
        accessToken: "EAA" + "x".repeat(30),
      },
      expect.anything(),
    );
  });

  it("servidor sem Meta configurada: explica e desabilita o envio", () => {
    state.data = { ...base, serverReady: false };
    render(<MetaCard />);

    expect(
      screen.getByText(/ainda não está habilitado para a Meta/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /Validar e usar/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
