import type {
  ConnectionCheck,
  ConnectionStep,
  IntegrationProvider,
  IntegrationStatus,
  ProfessionalDto,
  ProfessionalPolicy,
} from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { IntegrationTab } from "./integration-tab";

/**
 * A aba de integração guarda a credencial que dá acesso à agenda e ao cadastro
 * de pacientes reais. O que estes testes protegem: o segredo nunca aparece na
 * tela, o mapeamento sugerido é uma sugestão para confirmar — não uma decisão
 * aplicada pelas nossas costas — e a escolha entre Clinicorp e Google Agenda é
 * explícita, inclusive o efeito de ligar um desligar o outro.
 *
 * Desde o P0.1, protegem também que uma falha **apareça**: esta aba não tinha
 * tratamento de erro nenhum, e um botão que não faz nada era indistinguível de
 * um botão quebrado.
 */

const state = vi.hoisted(() => ({
  data: {
    clinicorp: null as IntegrationStatus | null,
    google: null as IntegrationStatus | null,
  },
  queryError: {
    clinicorp: null as Error | null,
    google: null as Error | null,
  },
  refetch: {
    clinicorp: vi.fn(),
    google: vi.fn(),
  },
  check: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null as unknown,
    data: undefined as ConnectionCheck | undefined,
  },
  update: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null as unknown,
  },
  professionals: [] as ProfessionalDto[],
  createProfessional: { mutate: vi.fn(), isPending: false },
  updateProfessional: { mutate: vi.fn(), isPending: false },
  updateSettings: { mutate: vi.fn(), isPending: false },
  professionalPolicy: "primeiro_livre" as ProfessionalPolicy,
}));

// A aba dispara uma sincronização depois de uma verificação bem-sucedida.
vi.mock("@/hooks/use-agenda", () => ({
  useSyncAgenda: () => ({ mutate: vi.fn(), isPending: false }),
}));

// A equipe vem do cadastro espelhado (F20), não do resultado da verificação.
vi.mock("@/hooks/use-professionals", () => ({
  useProfessionals: () => ({ data: state.professionals, isLoading: false }),
  useCreateProfessional: () => state.createProfessional,
  useUpdateProfessional: () => state.updateProfessional,
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: { professionalPolicy: state.professionalPolicy },
  }),
  useUpdateSettings: () => state.updateSettings,
}));

vi.mock("@/hooks/use-integration", () => ({
  useIntegration: (provider: IntegrationProvider) => ({
    data: state.data[provider],
    isLoading:
      state.data[provider] === null && state.queryError[provider] === null,
    isError: state.queryError[provider] !== null,
    error: state.queryError[provider],
    refetch: state.refetch[provider],
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
    categoryExternalId: null,
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

/** Um passo da verificação — `kind` é null quando passou (P0.1). */
function step(over: Partial<ConnectionStep> = {}): ConnectionStep {
  return {
    key: "credenciais",
    label: "Credenciais e modo",
    ok: true,
    detail: "Modo real.",
    kind: null,
    durationMs: 0,
    ...over,
  };
}

function check(over: Partial<ConnectionCheck> = {}): ConnectionCheck {
  return {
    ok: true,
    mode: "live",
    checkedAt: new Date().toISOString(),
    steps: [],
    requestId: null,
    units: [],
    professionals: [],
    statuses: [],
    categories: [],
    procedures: [],
    suggestedMappings: [],
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  state.data.clinicorp = null;
  state.data.google = null;
  state.queryError.clinicorp = null;
  state.queryError.google = null;
  state.check.data = undefined;
  state.check.isError = false;
  state.check.error = null;
  state.update.isError = false;
  state.update.error = null;
  state.professionals = [];
  state.professionalPolicy = "primeiro_livre";
});

describe("IntegrationTab", () => {
  it("mostra a falha da consulta em vez de um skeleton eterno", () => {
    state.queryError.clinicorp = new Error("Agenda indisponível");
    render(<IntegrationTab />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Agenda indisponível",
    );
    fireEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(state.refetch.clinicorp).toHaveBeenCalledOnce();
  });

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
    state.check.data = check({
      ok: false,
      steps: [
        step(),
        step({
          key: "unidades",
          label: "Listar unidades",
          ok: false,
          detail: "Clinicorp respondeu 401 (verifique usuário/token da API)",
          kind: "auth",
          durationMs: 320,
        }),
      ],
    });
    render(<IntegrationTab />);

    expect(screen.getByText(/A verificação parou/i)).toBeInTheDocument();
    expect(screen.getByText(/respondeu 401/i)).toBeInTheDocument();
  });

  /**
   * O ponto do P0.1: "credencial recusada" e "Google fora do ar" chegavam à
   * tela como a mesma caixa cinza, e uma exige o operador enquanto a outra
   * exige esperar.
   */
  describe("o que fazer a respeito (P0.1)", () => {
    it("credencial recusada manda conferir o que está salvo", () => {
      state.data.clinicorp = status();
      state.check.data = check({
        ok: false,
        steps: [step({ ok: false, detail: "401", kind: "auth" })],
      });
      render(<IntegrationTab />);

      expect(screen.getByText(/credencial foi recusada/i)).toBeInTheDocument();
    });

    it("agenda fora do ar diz que não há nada a corrigir aqui", () => {
      state.data.clinicorp = status();
      state.check.data = check({
        ok: false,
        steps: [step({ ok: false, detail: "503", kind: "indisponivel" })],
      });
      render(<IntegrationTab />);

      expect(
        screen.getByText(/nada precisa ser corrigido aqui/i),
      ).toBeInTheDocument();
    });

    it("passo que deu certo não ganha orientação de erro", () => {
      state.data.clinicorp = status();
      state.check.data = check({ steps: [step()] });
      render(<IntegrationTab />);

      expect(screen.queryByText(/credencial foi recusada/i)).toBeNull();
    });

    it("mostra o código de correlação para o suporte", () => {
      state.data.clinicorp = status();
      state.check.data = check({ requestId: "req-abc-123" });
      render(<IntegrationTab />);

      expect(screen.getByText("req-abc-123")).toBeInTheDocument();
    });
  });

  describe("a chamada em si falhou", () => {
    it("verificação que nem chegou ao servidor aparece na tela", () => {
      state.data.clinicorp = status();
      state.check.isError = true;
      state.check.error = new ApiError(
        503,
        JSON.stringify({ statusCode: 503, message: "Serviço indisponível" }),
        "req-xyz",
      );
      render(<IntegrationTab />);

      // A frase, não o JSON cru do corpo de erro do Nest.
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Serviço indisponível",
      );
      expect(screen.getByText("req-xyz")).toBeInTheDocument();
    });

    it("falha ao salvar não passa despercebida", () => {
      state.data.clinicorp = status();
      state.update.isError = true;
      state.update.error = new Error("Sessão expirada");
      render(<IntegrationTab />);

      expect(screen.getByRole("alert")).toHaveTextContent("Sessão expirada");
    });
  });

  it("sem credencial salva, oferece o texto do pedido ao suporte", () => {
    state.data.clinicorp = status({ hasCredentials: false });
    render(<IntegrationTab />);

    expect(screen.getByText(/Ainda não tenho a credencial/i)).toBeInTheDocument();
    expect(screen.getByText(/Subscriber ID da minha conta/i)).toBeInTheDocument();
  });

  it("com a credencial já salva, o pedido some da tela", () => {
    state.data.clinicorp = status({ hasCredentials: true });
    render(<IntegrationTab />);

    expect(screen.queryByText(/Ainda não tenho a credencial/i)).toBeNull();
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
    state.check.data = check({
      statuses: [{ id: "6", name: "Faltou" }],
      suggestedMappings: [
        { externalId: "6", externalName: "Faltou", status: "faltou" },
      ],
    });
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

  describe("Equipe e agendamento (F20)", () => {
    const equipe: ProfessionalDto[] = [
      {
        id: "p1",
        externalId: "10",
        name: "Dra. Ana Ribeiro",
        active: true,
        unitExternalId: "1",
        createdAt: "2026-09-17T12:00:00.000Z",
      },
      {
        id: "p2",
        externalId: "",
        name: "Dr. Bruno Lima",
        active: false,
        unitExternalId: "",
        createdAt: "2026-09-17T12:01:00.000Z",
      },
    ];

    it("a equipe aparece sem depender de ter acabado de verificar a conexão", () => {
      // Antes da F20 a lista vinha de `check.data.professionals`: recarregar a
      // página fazia o cartão inteiro sumir da tela.
      state.data.clinicorp = status();
      state.professionals = equipe;
      render(<IntegrationTab />);

      expect(screen.getByText("Dra. Ana Ribeiro")).toBeInTheDocument();
      expect(screen.getByText("Dr. Bruno Lima")).toBeInTheDocument();
    });

    it("distingue quem veio do Clinicorp de quem foi cadastrado aqui", () => {
      state.data.clinicorp = status();
      state.professionals = equipe;
      render(<IntegrationTab />);

      expect(screen.getByText(/Vem do Clinicorp \(10\)/)).toBeInTheDocument();
      expect(screen.getByText("Cadastrado aqui")).toBeInTheDocument();
    });

    it("desativar é um interruptor por profissional, não uma exclusão", () => {
      state.data.clinicorp = status();
      state.professionals = equipe;
      render(<IntegrationTab />);

      fireEvent.click(
        screen.getByRole("switch", { name: /Desativar Dra. Ana Ribeiro/i }),
      );

      expect(state.updateProfessional.mutate).toHaveBeenCalledWith({
        id: "p1",
        active: false,
      });
    });

    it("escolher um profissional fixo não mexe na política", () => {
      state.data.clinicorp = status();
      state.professionals = equipe;
      render(<IntegrationTab />);

      expect(
        screen.getByText(/oferece os primeiros horários livres/i),
      ).toBeInTheDocument();
      expect(state.updateSettings.mutate).not.toHaveBeenCalled();
    });

    it("com profissional fixo, a tela diz que tudo cai nele", () => {
      state.data.clinicorp = status({ professionalId: "p1" });
      state.professionals = equipe;
      render(<IntegrationTab />);

      expect(
        screen.getByText(/Todos os agendamentos do agente vão para esta pessoa/i),
      ).toBeInTheDocument();
    });

    it("a política escolhida pelo dono é o que a tela reflete", () => {
      state.data.clinicorp = status();
      state.professionals = equipe;
      state.professionalPolicy = "perguntar";
      render(<IntegrationTab />);

      expect(
        screen.getByText(/pergunta a preferência antes de oferecer/i),
      ).toBeInTheDocument();
    });

    it("acrescentar à mão exige um nome", () => {
      state.data.clinicorp = status();
      render(<IntegrationTab />);

      const botao = screen.getByRole("button", { name: /Acrescentar/i });
      expect(botao).toBeDisabled();

      fireEvent.change(
        screen.getByLabelText(/Nome do profissional a acrescentar/i),
        { target: { value: "Dra. Carla Souza" } },
      );
      fireEvent.click(botao);

      expect(state.createProfessional.mutate).toHaveBeenCalledWith(
        { name: "Dra. Carla Souza" },
        expect.anything(),
      );
    });

    it("a categoria só é oferecida depois de a conta devolver alguma", () => {
      state.data.clinicorp = status();
      render(<IntegrationTab />);
      expect(
        screen.queryByLabelText(/Categoria do agendamento/i),
      ).not.toBeInTheDocument();

      state.check.data = check({
        categories: [{ id: "Consulta", name: "Consulta" }],
      });
      render(<IntegrationTab />);
      expect(
        screen.getAllByLabelText(/Categoria do agendamento/i).length,
      ).toBeGreaterThan(0);
    });

    it("oferece importar o catálogo da conta, dizendo o que continua manual", () => {
      state.data.clinicorp = status();
      state.check.data = check({
        procedures: [
          { name: "Limpeza", expertise: "Periodontia" },
          { name: "Clareamento", expertise: "Dentística" },
        ],
      });
      render(<IntegrationTab />);

      expect(
        screen.getByRole("button", { name: /Importar 2 procedimento/i }),
      ).toBeInTheDocument();
    });
  });
});
