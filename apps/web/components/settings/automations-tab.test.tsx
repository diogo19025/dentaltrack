import {
  type AutomationSettings,
  DEFAULT_AUTOMATION_SETTINGS,
} from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationsTab } from "./automations-tab";

/**
 * A aba de automações edita mensagens que saem sozinhas no nome da empresa.
 * O que estes testes protegem: o dono precisa (1) ver exatamente o texto que o
 * cliente vai receber antes de ligar, e (2) nunca perder o que digitou por
 * causa de um refetch — daí o estado ser derivado, sem efeito de sincronização.
 */

const state = vi.hoisted(() => ({
  data: null as AutomationSettings | null,
  queryError: null as Error | null,
  refetch: vi.fn(),
  update: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock("@/hooks/use-automations", () => ({
  useAutomations: () => ({
    data: state.data,
    isLoading: state.data === null && state.queryError === null,
    isError: state.queryError !== null,
    error: state.queryError,
    refetch: state.refetch,
  }),
  useUpdateAutomations: () => state.update,
  useHolidays: () => ({ data: [], isLoading: false }),
  useCreateHoliday: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteHoliday: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncHolidays: () => ({ mutate: vi.fn(), isPending: false }),
}));

afterEach(() => {
  vi.clearAllMocks();
  state.data = null;
  state.queryError = null;
  state.update.isError = false;
  state.update.error = null;
});

describe("AutomationsTab", () => {
  it("mostra a falha da consulta em vez de um skeleton eterno", () => {
    state.queryError = new Error("Automações indisponíveis");
    render(<AutomationsTab />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Automações indisponíveis",
    );
    fireEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it("mostra o texto já preenchido, como o cliente vai receber", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);

    // A prévia é o texto já resolvido: nenhum marcador cru sobrevive nela.
    // (O marcador segue visível no campo de edição, que é onde ele deve estar.)
    const previews = screen.getAllByText(/Marina/);
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview.textContent).not.toMatch(/\{\w+\}/);
    }
  });

  it("o aviso de atraso chega desligado e explica o porquê", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);

    const toggle = screen.getByRole("switch", {
      name: /Ativar Aviso de atraso/i,
    });
    expect(toggle).toHaveAttribute("data-state", "unchecked");
    expect(
      screen.getByText(/já está na sala de espera/i),
    ).toBeInTheDocument();
  });

  it("o teto de tentativas da remarcação não passa de 3", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);

    const attempts = screen.getByLabelText(/Tentativas \(m/i);
    fireEvent.change(attempts, { target: { value: "9" } });

    expect((attempts as HTMLInputElement).value).toBe("3");
  });

  it("salvar envia a configuração editada", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);

    fireEvent.change(screen.getByLabelText(/Teto de mensagens por dia/i), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/i }));

    expect(state.update.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ dailyCap: 50 }),
      expect.anything(),
    );
  });

  it("sem edição, o botão indica que está tudo salvo", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);

    expect(screen.getByRole("button", { name: /Tudo salvo/i })).toBeDisabled();
  });
});
