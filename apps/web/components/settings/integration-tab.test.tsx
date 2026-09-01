import type { ConnectionCheck, IntegrationStatus } from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationTab } from "./integration-tab";

/**
 * A aba de integração guarda a credencial que dá acesso à agenda e ao cadastro
 * de pacientes reais. O que estes testes protegem: o segredo nunca aparece na
 * tela, e o mapeamento sugerido é uma sugestão para confirmar — não uma decisão
 * aplicada pelas nossas costas.
 */

const state = vi.hoisted(() => ({
  data: null as IntegrationStatus | null,
  check: {
    mutate: vi.fn(),
    isPending: false,
    data: undefined as ConnectionCheck | undefined,
  },
  update: { mutate: vi.fn(), isPending: false },
}));

// A aba dispara uma sincronização depois de uma verificação bem-sucedida.
vi.mock("@/hooks/use-agenda", () => ({
  useSyncAgenda: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-integration", () => ({
  useIntegration: () => ({ data: state.data, isLoading: state.data === null }),
  useUpdateIntegration: () => state.update,
  useCheckIntegration: () => state.check,
}));

function status(over: Partial<IntegrationStatus> = {}): IntegrationStatus {
  return {
    provider: "clinicorp",
    mode: "live",
    hasCredentials: true,
    usernameHint: "ap******rp",
    unitId: null,
    professionalId: null,
    statusMappings: [],
    lastCheckedAt: null,
    lastSyncedAt: null,
    lastError: null,
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  state.data = null;
  state.check.data = undefined;
});

describe("IntegrationTab", () => {
  it("nunca preenche o token, mesmo com credencial salva", () => {
    state.data = status();
    render(<IntegrationTab />);

    const token = screen.getByLabelText(/Token da API/i) as HTMLInputElement;
    expect(token.value).toBe("");
    expect(token.type).toBe("password");
    // A dica do usuário ajuda a reconhecer a credencial sem revelá-la.
    expect(screen.getByPlaceholderText("ap******rp")).toBeInTheDocument();
  });

  it("explica que a credencial da API não é o login do painel", () => {
    state.data = status();
    render(<IntegrationTab />);

    expect(screen.getByText(/não é o login do painel/i)).toBeInTheDocument();
  });

  it("modo desligado não pede credencial e explica o comportamento", () => {
    state.data = status({ mode: "desligado", hasCredentials: false });
    render(<IntegrationTab />);

    expect(screen.queryByLabelText(/Token da API/i)).toBeNull();
    expect(screen.getByText(/a equipe confirma/i)).toBeInTheDocument();
  });

  it("mostra o passo a passo da verificação, com o erro que a parou", () => {
    state.data = status();
    state.check.data = {
      ok: false,
      mode: "live",
      checkedAt: new Date().toISOString(),
      steps: [
        {
          key: "credenciais",
          label: "Credenciais e modo",
          ok: true,
          detail: "Modo real.",
          durationMs: 0,
        },
        {
          key: "unidades",
          label: "Listar unidades",
          ok: false,
          detail: "Clinicorp respondeu 401 (verifique usuário/token da API)",
          durationMs: 320,
        },
      ],
      units: [],
      professionals: [],
      statuses: [],
      suggestedMappings: [],
    };
    render(<IntegrationTab />);

    expect(screen.getByText(/A verificação parou/i)).toBeInTheDocument();
    expect(screen.getByText(/respondeu 401/i)).toBeInTheDocument();
  });

  it("avisa quando falta mapear um status de que as automações dependem", () => {
    state.data = status({
      statusMappings: [
        { externalId: "1", externalName: "Agendado", status: "agendado" },
      ],
    });
    render(<IntegrationTab />);

    expect(screen.getByText(/não vão disparar/i)).toBeInTheDocument();
  });

  it("usa o mapeamento sugerido pela verificação, sem aplicá-lo sozinho", () => {
    state.data = status();
    state.check.data = {
      ok: true,
      mode: "live",
      checkedAt: new Date().toISOString(),
      steps: [],
      units: [],
      professionals: [],
      statuses: [{ id: "6", name: "Faltou" }],
      suggestedMappings: [
        { externalId: "6", externalName: "Faltou", status: "faltou" },
      ],
    };
    render(<IntegrationTab />);

    // A sugestão aparece na tela (o nome da conta e o significado escolhido)…
    expect(screen.getAllByText("Faltou").length).toBeGreaterThan(0);
    // …mas só vale depois que o operador salvar.
    expect(state.update.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Salvar tradução/i }));
    expect(state.update.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        statusMappings: [
          { externalId: "6", externalName: "Faltou", status: "faltou" },
        ],
      }),
      expect.anything(),
    );
  });
});
