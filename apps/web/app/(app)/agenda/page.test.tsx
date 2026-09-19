import type { AppointmentSummary, ProfessionalDto } from "@dentaltrack/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AgendaPage from "./page";

/**
 * Agenda por profissional (F20): a tela precisa mostrar **quem** atende cada
 * horário — filtro, legenda e nome no card — a partir do cadastro espelhado,
 * não do texto solto que a sincronização gravava antes.
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

// As ações por agendamento usam mutações (QueryClientProvider); têm testes
// próprios em `components/agenda/appointment-actions.test.tsx`.
vi.mock("@/components/agenda/appointment-actions", () => ({
  AppointmentActions: () => null,
}));

vi.mock("@/components/agenda/scheduled-messages", () => ({
  ScheduledMessagesCard: () => null,
}));

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
  it("a cor é sempre do profissional: sem escolha de modo, e o bloco leva a cor dele", () => {
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
    // 1º da lista → chart-1 no bloco da grade.
    expect(
      screen.getByTitle(
        /14:00 – 14:30 · Maria Souza · Limpeza · Dra\. Ana Ribeiro/,
      ),
    ).toHaveStyle({ background: "var(--chart-1)" });
  });

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
