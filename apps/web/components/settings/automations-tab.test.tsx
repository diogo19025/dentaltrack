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
 *
 * Os campos vivem num painel por grupo; a visão geral só resume. Por isso os
 * testes abrem o grupo antes de procurar o campo — e o rascunho tem de
 * sobreviver ao fechar o painel, senão o Salvar único não faria sentido.
 */

function openGroup(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

const state = vi.hoisted(() => ({
  data: null as AutomationSettings | null,
  holidays: [] as { id: string; date: string; name: string; scope: string }[],
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
  useHolidays: () => ({ data: state.holidays, isLoading: false }),
  useCreateHoliday: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteHoliday: () => ({ mutate: vi.fn(), isPending: false }),
  useSyncHolidays: () => ({ mutate: vi.fn(), isPending: false }),
}));

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  state.data = null;
  state.holidays = [];
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
    openGroup(/Configurar Lembretes de consulta/i);

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
    openGroup(/Configurar Atrasos e faltas/i);

    const toggle = screen.getByRole("switch", {
      name: /Ativar Aviso de atraso/i,
    });
    expect(toggle).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByText(/já está na sala de espera/i)).toBeInTheDocument();
  });

  it("o teto de tentativas da remarcação não passa de 3", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);
    openGroup(/Configurar Atrasos e faltas/i);

    const attempts = screen.getByLabelText(/Tentativas \(m/i);
    fireEvent.change(attempts, { target: { value: "9" } });

    expect((attempts as HTMLInputElement).value).toBe("3");
  });

  it("salvar envia a configuração editada, mesmo depois de fechar o painel", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);

    openGroup(/Configurar Regras de envio/i);
    fireEvent.change(screen.getByLabelText(/Teto de mensagens por dia/i), {
      target: { value: "50" },
    });
    // Fechar o painel não descarta o rascunho — o Salvar é o da aba.
    fireEvent.click(screen.getByRole("button", { name: /^Voltar$/i }));
    expect(screen.queryByLabelText(/Teto de mensagens por dia/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/i }));

    expect(state.update.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ dailyCap: 50 }),
      expect.anything(),
    );
  });

  it("a visão geral resume os grupos sem mostrar os campos", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);

    expect(screen.getByText("Regras de envio")).toBeInTheDocument();
    expect(screen.getByText("Lembretes de consulta")).toBeInTheDocument();
    expect(screen.getByText("Atrasos e faltas")).toBeInTheDocument();
    expect(screen.getByText("Retorno de clientes")).toBeInTheDocument();
    expect(screen.getByText("3 de 3 ativos")).toBeInTheDocument();
    expect(screen.getByText("1 de 2 ativos")).toBeInTheDocument();

    // Nenhum campo de texto na visão geral: eles só aparecem no painel.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a visão geral reflete o que foi desligado no painel", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);

    openGroup(/Configurar Lembretes de consulta/i);
    fireEvent.click(
      screen.getByRole("switch", { name: /Ativar Lembrete — 1 hora antes/i }),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("2 de 3 ativos")).toBeInTheDocument();
  });

  it("feriados: mostra só os próximos 5 e o resto atrás de um botão", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    const year = new Date().getFullYear() + 1; // tudo no futuro → os 5 primeiros
    state.holidays = Array.from({ length: 12 }, (_, i) => ({
      id: `h${i}`,
      date: `${year}-${String(i + 1).padStart(2, "0")}-10`,
      name: `Feriado ${i + 1}`,
      scope: "nacional",
    }));
    render(<AutomationsTab />);
    openGroup(/Configurar Regras de envio/i);

    expect(screen.getAllByText(/^Feriado \d+$/)).toHaveLength(5);
    expect(screen.getByText("Feriado 1")).toBeInTheDocument();
    expect(screen.queryByText("Feriado 6")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Mostrar todos/i }));
    expect(screen.getAllByText(/^Feriado \d+$/)).toHaveLength(12);

    fireEvent.click(screen.getByRole("button", { name: /Mostrar menos/i }));
    expect(screen.getAllByText(/^Feriado \d+$/)).toHaveLength(5);
  });

  it("feriados: com 5 ou menos, não há botão de mostrar todos", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    state.holidays = [
      { id: "a", date: "2099-01-01", name: "Único", scope: "local" },
    ];
    render(<AutomationsTab />);
    openGroup(/Configurar Regras de envio/i);

    expect(screen.getByText("Único")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mostrar todos/i })).toBeNull();
  });

  it("fuso horário é uma lista fechada de fusos do Brasil, não um campo livre", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);
    openGroup(/Configurar Regras de envio/i);

    const select = screen.getByRole("combobox", { name: /Fuso horário/i });
    expect(select).toHaveTextContent(/GMT-3 · Brasília/);
    expect(screen.queryByDisplayValue("America/Sao_Paulo")).toBeNull();
  });

  it("palavras de manutenção: vírgula e espaço não somem enquanto se digita", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);
    openGroup(/Configurar Retorno de clientes/i);

    const input = screen.getByLabelText(/O que conta como manutenção/i);
    fireEvent.change(input, { target: { value: "limpeza, " } });
    expect((input as HTMLInputElement).value).toBe("limpeza, ");

    fireEvent.change(input, { target: { value: "limpeza, revisão" } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("limpeza, revisão");

    fireEvent.click(screen.getByRole("button", { name: /^Voltar$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/i }));
    expect(state.update.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        retorno: expect.objectContaining({
          procedureKeywords: ["limpeza", "revisão"],
        }),
      }),
      expect.anything(),
    );
  });

  it("automação desligada nasce recolhida; ligar expande, e dá para recolher de novo", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);
    openGroup(/Configurar Atrasos e faltas/i);

    // Aviso de atraso vem desligado: aviso visível, campos escondidos.
    // O corpo fica montado (é o que permite animar), mas invisível e inerte.
    expect(screen.getByText(/já está na sala de espera/i)).toBeInTheDocument();
    const tolerance = screen.getByLabelText(/Tolerância \(minutos\)/i);
    expect(tolerance).not.toBeVisible();

    fireEvent.click(
      screen.getAllByRole("button", { name: /Ver detalhes/i })[0],
    );
    expect(tolerance).toBeVisible();

    fireEvent.click(screen.getAllByRole("button", { name: /^Recolher$/i })[0]);
    expect(tolerance).not.toBeVisible();

    // Ligar expande sozinho.
    fireEvent.click(
      screen.getByRole("switch", { name: /Ativar Aviso de atraso/i }),
    );
    expect(tolerance).toBeVisible();

    // Remarcação após falta vem ligada: já expandida.
    expect(screen.getByLabelText(/Tentativas \(m/i)).toBeVisible();
  });

  it("expandido/recolhido sobrevive a fechar e reabrir o painel", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);

    // Expande o atraso (desligado, nasce recolhido) e recolhe a falta (ligada).
    openGroup(/Configurar Atrasos e faltas/i);
    fireEvent.click(screen.getByRole("button", { name: /Ver detalhes/i }));
    // Com o atraso expandido, há dois "Recolher": o segundo é o da falta.
    fireEvent.click(screen.getAllByRole("button", { name: /^Recolher$/i })[1]);
    fireEvent.click(screen.getByRole("button", { name: /^Voltar$/i }));

    openGroup(/Configurar Atrasos e faltas/i);
    expect(screen.getByLabelText(/Tolerância \(minutos\)/i)).toBeVisible();
    expect(screen.getByLabelText(/Tentativas \(m/i)).not.toBeVisible();
  });

  it("sem edição, o botão indica que está tudo salvo", () => {
    state.data = { ...DEFAULT_AUTOMATION_SETTINGS };
    render(<AutomationsTab />);

    expect(screen.getByRole("button", { name: /Tudo salvo/i })).toBeDisabled();
  });
});
