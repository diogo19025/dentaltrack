import type { WhatsappConnection } from "@dentaltrack/shared";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsappStatusBanner } from "./topbar";

vi.mock("@/components/auth/role-context", () => ({
  useRole: () => ({ role: "owner", isOwner: true }),
}));

const state = vi.hoisted(() => ({
  connection: null as WhatsappConnection | null,
}));

vi.mock("@/hooks/use-whatsapp-connection", () => ({
  useWhatsappConnection: () => ({ data: state.connection }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/components/shell/notifications-bell", () => ({
  NotificationsBell: () => null,
}));

function connection(
  over: Partial<WhatsappConnection> = {},
): WhatsappConnection {
  return {
    state: "conectado",
    instanceName: "empresa-demo",
    phone: "5511999998888",
    qrCode: null,
    pairingCode: null,
    onboardingAnswered: true,
    serverReady: true,
    lastError: null,
    ...over,
  };
}

afterEach(() => {
  state.connection = null;
});

describe("WhatsappStatusBanner", () => {
  it("não aparece quando a instância está conectada", () => {
    state.connection = connection();
    render(<WhatsappStatusBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("avisa a queda e leva direto à aba do WhatsApp", () => {
    state.connection = connection({ state: "desconectado" });
    render(<WhatsappStatusBanner />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "A sessão do WhatsApp caiu",
    );
    expect(screen.getByRole("link", { name: "Reconectar" })).toHaveAttribute(
      "href",
      "/settings?tab=whatsapp",
    );
  });

  /**
   * O alerta aparecia para qualquer estado diferente de `conectado`, então
   * acusava falha **durante o pareamento** — com o dono olhando o QR na tela.
   * Alerta que toca na operação normal é alerta que se aprende a ignorar.
   */
  it("fica calado enquanto o QR está sendo lido", () => {
    state.connection = connection({ state: "aguardando_leitura" });
    render(<WhatsappStatusBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fica calado quando não há instância configurada", () => {
    state.connection = connection({
      state: "nao_configurado",
      instanceName: null,
    });
    render(<WhatsappStatusBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
