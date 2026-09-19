import type { AppointmentSummary, ProfessionalDto } from "@dentaltrack/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgendaPage from "./page";

/**
 * Agenda por profissional (F20): a tela mostra **quem** atende cada horário —
 * filtro, legenda e nome no card — a partir do cadastro espelhado. A cor é
 * sempre a do profissional; clicar num agendamento abre o painel de detalhe.
 */

const state = vi.hoisted(() => ({
  professionals: [] as ProfessionalDto[],
  appointments: [] as AppointmentSummary[],
}));

vi.mock("@/hooks/use-professionals", () => ({
  useProfessionals: () => ({ data: state.professionals, isLoading: false }),
}));

vi.mock("@/hooks/use-agenda", () => ({
  useAgenda: () => ({
    data: { appointments: state.appointments, lastSyncedAt: null },
    isLoading: false,
  }),
  useSyncAgenda: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelAppointment: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useRescheduleAppointment: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-automations", () => ({
  useAutomationHistory: () => ({ data: [] }),
}));

vi.mock("@/hooks/use-integration", () => ({
  useIntegration: () => ({ data: null }),
}));

vi.mock("@/components/auth/role-context", () => ({
  OwnerOnly: ({ children }: { children: React.ReactNode }) => children,
  useRole: () => ({ isOwner: true, role: "owner" }),
}));

vi.mock("@/components/agenda/scheduled-messages", () => ({
  ScheduledMessagesCard: () => null,
}));

// Quarta-feira 16/09/2026, 10h: "amanhã" cai na mesma semana da grade.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 16, 10, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

function professional(over: Partial<ProfessionalDto>): ProfessionalDto {
  return {
    id: "00000000-0000-0000-0000-00000000000a",
    externalId: "10",
    name: "Dra. Ana Ribeiro",
    active: true,
    unitExternalId: "1",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function appointment(over: Partial<AppointmentSummary>): AppointmentSummary {
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + 1);
  startsAt.setHours(14, 0, 0, 0);
  return {
    id: "11111111-1111-1111-1111-111111111111",
    status: "agendado",
    source: "integracao",
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
    preferredTime: null,
    procedureName: "Limpeza",
    professionalName: "Dra. Ana Ribeiro",
    professionalId: "00000000-0000-0000-0000-00000000000a",
    leadId: null,
    leadName: "Maria Souza",
    leadPhone: null,
    conversationId: null,
    externalId: "ext-1",
    canceledAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("AgendaPage — profissionais", () => {
  it("com equipe de 2+, oferece filtro, legenda por cor e o nome no card", () => {
    state.professionals = [
      professional({}),
      professional({
        id: "00000000-0000-0000-0000-00000000000b",
        externalId: "11",
        name: "Dr. Bruno Lima",
      }),
    ];
    state.appointments = [appointment({})];

    render(<AgendaPage />);

    expect(
      screen.getByRole("combobox", { name: "Filtrar por profissional" }),
    ).toBeInTheDocument();
    const legend = screen.getByRole("list", {
      name: "Legenda de profissionais",
    });
    expect(legend).toHaveTextContent("Dra. Ana Ribeiro");
    expect(legend).toHaveTextContent("Dr. Bruno Lima");
    // O nome aparece no card do próximo agendamento.
    expect(screen.getAllByText(/· Dra\. Ana Ribeiro/).length).toBeGreaterThan(
      0,
    );
  });

  it("a legenda é filtro rápido: clicar num nome isola o profissional", () => {
    const bruno = "00000000-0000-0000-0000-00000000000b";
    state.professionals = [
      professional({}),
      professional({ id: bruno, externalId: "11", name: "Dr. Bruno Lima" }),
    ];
    state.appointments = [
      appointment({}),
      appointment({
        id: "22222222-2222-2222-2222-222222222222",
        leadName: "João Pedro",
        professionalId: bruno,
        professionalName: "Dr. Bruno Lima",
      }),
    ];

    render(<AgendaPage />);

    const legend = screen.getByRole("list", {
      name: "Legenda de profissionais",
    });
    const chip = within(legend).getByRole("button", { name: "Dr. Bruno Lima" });
    fireEvent.click(chip);

    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /14:00 – 14:30 · João Pedro/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /14:00 – 14:30 · Maria Souza/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: /14:00 – 14:30 · Maria Souza/ }),
    ).toBeInTheDocument();
  });

  it("a cor é sempre do profissional: não há escolha de modo de cor", () => {
    state.professionals = [
      professional({}),
      professional({
        id: "00000000-0000-0000-0000-00000000000b",
        externalId: "11",
        name: "Dr. Bruno Lima",
      }),
    ];
    state.appointments = [appointment({})];

    render(<AgendaPage />);

    expect(
      screen.queryByRole("tablist", { name: "Cor dos agendamentos" }),
    ).not.toBeInTheDocument();
    // O bloco na grade leva a cor do profissional (1º da lista → chart-1).
    const block = screen.getByRole("button", {
      name: /14:00 – 14:30 · Maria Souza · Limpeza · Dra\. Ana Ribeiro/,
    });
    expect(block.style.getPropertyValue("--pro")).toBe("var(--chart-1)");
  });

  it("com um profissional só, não há legenda", () => {
    state.professionals = [professional({})];
    state.appointments = [appointment({})];

    render(<AgendaPage />);

    expect(
      screen.getByRole("combobox", { name: "Filtrar por profissional" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Legenda de profissionais" }),
    ).not.toBeInTheDocument();
  });

  it("sem cadastro, a tela fica como era", () => {
    state.professionals = [];
    state.appointments = [appointment({ professionalId: null })];

    render(<AgendaPage />);

    expect(
      screen.queryByRole("combobox", { name: "Filtrar por profissional" }),
    ).not.toBeInTheDocument();
  });
});

describe("AgendaPage — semana", () => {
  it("a grade vai de segunda a domingo, e o botão Hoje volta para a semana atual", () => {
    state.professionals = [professional({})];
    state.appointments = [appointment({})];

    render(<AgendaPage />);

    expect(screen.getByText("14 de set. – 20 de set.")).toBeInTheDocument();
    const today = screen.getByRole("button", { name: "Hoje" });
    expect(today).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Próxima semana" }));
    expect(screen.getByText("21 de set. – 27 de set.")).toBeInTheDocument();
    expect(today).toBeEnabled();

    fireEvent.click(today);
    expect(screen.getByText("14 de set. – 20 de set.")).toBeInTheDocument();
  });
});

describe("AgendaPage — filtros e detalhe", () => {
  it("oferece o filtro por procedimento junto de situação, profissional e cliente", () => {
    state.professionals = [professional({})];
    state.appointments = [appointment({})];

    render(<AgendaPage />);

    const filters = screen.getByRole("search", { name: "Filtros da agenda" });
    for (const name of [
      "Filtrar por situação",
      "Filtrar por profissional",
      "Filtrar por procedimento",
      "Filtrar por cliente",
    ]) {
      expect(
        within(filters).getByRole("combobox", { name }),
      ).toBeInTheDocument();
    }
  });

  it("dois horários que coincidem ficam lado a lado na grade", () => {
    state.professionals = [professional({})];
    state.appointments = [
      appointment({}),
      appointment({
        id: "22222222-2222-2222-2222-222222222222",
        leadName: "João Pedro",
      }),
    ];

    render(<AgendaPage />);

    const first = screen.getByRole("button", {
      name: /14:00 – 14:30 · Maria Souza/,
    });
    const second = screen.getByRole("button", {
      name: /14:00 – 14:30 · João Pedro/,
    });
    expect(first.style.width).toBe("calc(50% - 5px)");
    expect(second.style.left).toBe("calc(50% + 4px)");
  });

  it("clicar num agendamento da grade abre o painel com os detalhes", () => {
    state.professionals = [professional({})];
    state.appointments = [appointment({ leadPhone: "(11) 99999-0000" })];

    render(<AgendaPage />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /14:00 – 14:30 · Maria Souza · Limpeza/,
      }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Limpeza" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Maria Souza");
    expect(dialog).toHaveTextContent("Dra. Ana Ribeiro");
    expect(dialog).toHaveTextContent("(11) 99999-0000");
    expect(
      within(dialog).getByRole("link", { name: /Conversar no WhatsApp/ }),
    ).toHaveAttribute("href", "https://wa.me/5511999990000");
  });
});
