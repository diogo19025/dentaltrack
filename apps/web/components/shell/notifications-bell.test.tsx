import type { NotificationsDto } from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsBell } from "./notifications-bell";

/**
 * O sino é a única superfície proativa do CRM — se ele mentir (badge sem
 * evento, evento sem badge) o dono para de confiar e volta a viver de F5.
 * O que estes testes protegem: contagem honesta, "visto" disparado só quando
 * há o que ver, e clique levando para a tela onde se age sobre o evento.
 */

const state = vi.hoisted(() => ({
  data: null as NotificationsDto | null,
  isLoading: false,
  markSeen: { mutate: vi.fn() },
  push: vi.fn(),
}));

vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({ data: state.data, isLoading: state.isLoading }),
  useMarkNotificationsSeen: () => state.markSeen,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push }),
}));

function dto(overrides: Partial<NotificationsDto> = {}): NotificationsDto {
  return { items: [], unreadCount: 0, seenAt: null, ...overrides };
}

const item = {
  id: "conversa_iniciada:c1",
  type: "conversa_iniciada" as const,
  title: "Nova conversa pelo WhatsApp",
  description: "Maria Souza",
  occurredAt: new Date().toISOString(),
  unread: true,
  channel: "whatsapp" as const,
};

afterEach(() => {
  vi.clearAllMocks();
  state.data = null;
  state.isLoading = false;
});

describe("NotificationsBell", () => {
  it("sem não lidas → sem badge; o rótulo é neutro", () => {
    state.data = dto();
    render(<NotificationsBell />);
    expect(screen.getByLabelText("Notificações")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("badge mostra a contagem e satura em 9+", () => {
    state.data = dto({ unreadCount: 3 });
    const { rerender } = render(<NotificationsBell />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Notificações (3 não lidas)"),
    ).toBeInTheDocument();

    state.data = dto({ unreadCount: 12 });
    rerender(<NotificationsBell />);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("abrir com não lidas mostra os itens e marca como visto", () => {
    state.data = dto({ items: [item], unreadCount: 1 });
    render(<NotificationsBell />);

    fireEvent.click(screen.getByLabelText("Notificações (1 não lidas)"));

    expect(screen.getByText("Nova conversa pelo WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    expect(state.markSeen.mutate).toHaveBeenCalledTimes(1);
  });

  it("abrir sem não lidas NÃO dispara o 'visto' (rede à toa)", () => {
    state.data = dto({ items: [{ ...item, unread: false }] });
    render(<NotificationsBell />);

    fireEvent.click(screen.getByLabelText("Notificações"));

    expect(screen.getByText("Nova conversa pelo WhatsApp")).toBeInTheDocument();
    expect(state.markSeen.mutate).not.toHaveBeenCalled();
  });

  it("clicar num item navega para a tela do contexto", () => {
    state.data = dto({ items: [item], unreadCount: 1 });
    render(<NotificationsBell />);

    fireEvent.click(screen.getByLabelText("Notificações (1 não lidas)"));
    fireEvent.click(screen.getByText("Nova conversa pelo WhatsApp"));

    expect(state.push).toHaveBeenCalledWith("/");
  });

  it("sem eventos → estado vazio explica o que aparece aqui", () => {
    state.data = dto();
    render(<NotificationsBell />);

    fireEvent.click(screen.getByLabelText("Notificações"));

    expect(screen.getByText("Nada por aqui")).toBeInTheDocument();
  });
});
