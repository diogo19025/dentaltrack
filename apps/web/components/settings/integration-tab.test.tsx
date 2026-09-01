import type {
  ConnectionCheck,
  IntegrationProvider,
  IntegrationStatus,
} from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationTab } from "./integration-tab";

/**
 * A aba de integração guarda a credencial que dá acesso à agenda e ao cadastro
 * de pacientes reais. O que estes testes protegem: o segredo nunca aparece na
 * tela, o mapeamento sugerido é uma sugestão para confirmar — não uma decisão
 * aplicada pelas nossas costas — e a escolha entre Clinicorp e Google Agenda é
 * explícita, inclusive o efeito de ligar um desligar o outro.
 */

const state = vi.hoisted(() => ({
  data: {
    clinicorp: null as IntegrationStatus | null,
    google: null as IntegrationStatus | null,
  },
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
  useIntegration: (provider: IntegrationProvider) => ({
    data: state.data[provider],
    isLoading: state.data[provider] === null,
  }),
  useUpdateIntegration: () => state.update,
  useCheckIntegration: () => state.check,
}));

function status(over: Partial<IntegrationStatus> = {}): IntegrationStatus {
  return {
    provider: "clinicorp",
    mode: "live",
    activeProvider: null,
    hasCredentials: true,
    usernameHint: "ap******rp",
    google: null,
    serviceAccountEmail: null,
    unitId: null,
    professionalId: null,
    statusMappings: [],
    lastCheckedAt: null,
    lastSyncedAt: null,
    lastError: null,
    ...over,
  };
}

function googleStatus(over: Partial<IntegrationStatus> = {}): IntegrationStatus {
  return status({
    provider: "google",
    mode: "live",
    activeProvider: "google",
    hasCredentials: true,
    usernameHint: null,
    serviceAccountEmail: "agenda@projeto.iam.gserviceaccount.com",
    google: {
      calendarId: "clinica@group.calendar.google.com",
      workStart: "08:00",
      workEnd: "18:00",
      workDays: [1, 2, 3, 4, 5],
      slotMinutes: 30,
    },
    ...over,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  state.data.clinicorp = null;
  state.data.google = null;
  state.check.data = undefined;
});

describe("IntegrationTab", () => {
  it("nunca preenche o token, mesmo com credencial salva", () => {
    state.data.clinicorp = status();
    render(<IntegrationTab />);

    const token = screen.getByLabelText(/Token da API/i) as HTMLInputElement;
    expect(token.value).toBe("");
    expect(token.type).toBe("password");
    // A dica do usuário ajuda a reconhecer a credencial sem revelá-la.
    expect(screen.getByPlaceholderText("ap******rp")).toBeInTheDocument();
  });

  it("explica que a credencial da API não é o login do painel", () => {
    state.data.clinicorp = status();
    render(<IntegrationTab />);

    expect(screen.getByText(/não é o login do painel/i)).toBeInTheDocument();
  });

  it("modo desligado não pede credencial e explica o comportamento", () => {
    state.data.clinicorp = status({ mode: "desligado", hasCredentials: false });
    render(<IntegrationTab />);

    expect(screen.queryByLabelText(/Token da API/i)).toBeNull();
    expect(screen.getByText(/a equipe confirma/i)).toBeInTheDocument();
  });

  it("mostra o passo a passo da verificação, com o erro que a parou", () => {
    state.data.clinicorp = status();
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
    state.data.clinicorp = status({
      statusMappings: [
        { externalId: "1", externalName: "Agendado", status: "agendado" },
      ],
    });
    render(<IntegrationTab />);

    expect(screen.getByText(/não vão disparar/i)).toBeInTheDocument();
  });

  it("usa o mapeamento sugerido pela verificação, sem aplicá-lo sozinho", () => {
    state.data.clinicorp = status();
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

  describe("Google Agenda (F12)", () => {
    it("abre direto no provedor ativo — quem usa Google não cai no Clinicorp", () => {
      state.data.clinicorp = status({
        mode: "desligado",
        activeProvider: "google",
      });
      state.data.google = googleStatus();
      render(<IntegrationTab />);

      expect(screen.getByLabelText(/ID da agenda/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/Token da API/i)).toBeNull();
    });

    it("mostra com quem compartilhar a agenda e prefill do ID salvo", () => {
      state.data.clinicorp = status({
        mode: "desligado",
        activeProvider: "google",
      });
      state.data.google = googleStatus();
      render(<IntegrationTab />);

      expect(
        screen.getByText("agenda@projeto.iam.gserviceaccount.com"),
      ).toBeInTheDocument();
      const calendar = screen.getByLabelText(
        /ID da agenda/i,
      ) as HTMLInputElement;
      expect(calendar.value).toBe("clinica@group.calendar.google.com");
    });

    it("sem service account no servidor, avisa em vez de fingir que conecta", () => {
      state.data.clinicorp = status({
        mode: "desligado",
        activeProvider: "google",
      });
      state.data.google = googleStatus({ serviceAccountEmail: null });
      render(<IntegrationTab />);

      expect(
        screen.getByText(/GOOGLE_CALENDAR_SA_EMAIL/i),
      ).toBeInTheDocument();
    });

    it("salvar envia a configuração da agenda do Google", () => {
      state.data.clinicorp = status({
        mode: "desligado",
        activeProvider: "google",
      });
      state.data.google = googleStatus();
      render(<IntegrationTab />);

      fireEvent.change(screen.getByLabelText(/ID da agenda/i), {
        target: { value: "outra@group.calendar.google.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Salvar$/i }));

      expect(state.update.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          google: expect.objectContaining({
            calendarId: "outra@group.calendar.google.com",
            workDays: [1, 2, 3, 4, 5],
          }),
        }),
        expect.anything(),
      );
    });

    it("explica o limite honesto: sem presença, sem automação de falta", () => {
      state.data.clinicorp = status({
        mode: "desligado",
        activeProvider: "google",
      });
      state.data.google = googleStatus();
      render(<IntegrationTab />);

      expect(
        screen.getByText(/não registra presença/i),
      ).toBeInTheDocument();
    });

    it("avisa que ligar o Google desliga o Clinicorp ativo", () => {
      state.data.clinicorp = status({ activeProvider: "clinicorp" });
      state.data.google = googleStatus({
        mode: "live",
        activeProvider: "clinicorp",
      });
      render(<IntegrationTab />);

      fireEvent.click(screen.getByRole("tab", { name: /Google Agenda/i }));

      expect(
        screen.getByText(/desliga o Clinicorp/i),
      ).toBeInTheDocument();
    });
  });
});
