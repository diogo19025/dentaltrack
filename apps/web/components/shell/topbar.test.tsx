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
      "WhatsApp: desconectado",
    );
    expect(screen.getByRole("link", { name: "Ver conexão" })).toHaveAttribute(
      "href",
      "/settings?tab=whatsapp",
    );
  });
});
