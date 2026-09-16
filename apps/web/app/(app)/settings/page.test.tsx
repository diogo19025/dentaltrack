import {
  DEFAULT_AVAILABILITY,
  type ClinicSettingsDto,
} from "@dentaltrack/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";

/**
 * Regressão: o formulário de settings não pode ser sobrescrito enquanto o
 * usuário edita. Um novo `data` de useSettings() (refetch / atualização da
 * cache de ["settings"], hoje também assinada por Sidebar/Topbar) chegando no
 * meio da digitação apagava o campo — ver o guard `!formState.isDirty`.
 */

const state = vi.hoisted(() => ({
  data: null as ClinicSettingsDto | null,
  queryError: null as Error | null,
  refetch: vi.fn(),
  tab: null as string | null,
  update: {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  },
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: state.data,
    isLoading: state.data === null && state.queryError === null,
    isError: state.queryError !== null,
    error: state.queryError,
    refetch: state.refetch,
  }),
  useUpdateSettings: () => state.update,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(state.tab ? `tab=${state.tab}` : ""),
}));

vi.mock("@/components/settings/whatsapp-tab", () => ({
  WhatsappTab: () => <div>Configuração da conexão WhatsApp</div>,
}));

vi.mock("@/components/auth/role-context", () => ({
  OwnerOnly: ({ children }: { children: React.ReactNode }) => children,
}));

// O botão de enviar arquivo (F13) usa `useMutation`, que exige um
// QueryClientProvider. Esta suíte renderiza a página sem provider de propósito
// — o que ela verifica é o formulário. O upload tem testes próprios em
// `components/settings/media-upload-button.test.tsx`.
vi.mock("@/hooks/use-media-upload", () => ({
  useMediaUpload: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

// A sidebar/topbar não entram aqui; os hooks de leads/pipeline usados por elas
// não são exercitados nesta página, mas os filhos de outras abas importam hooks
// — a aba padrão ("identidade") não os renderiza, então não precisam de mock.

function makeSettings(
  over: Partial<ClinicSettingsDto> = {},
): ClinicSettingsDto {
  return {
    clinicName: "Empresa Demo",
    logoUrl: "",
    specialty: "",
    description: "",
    assistantName: "",
    tone: "amigavel",
    greeting: "",
    greetingMediaUrl: "",
    greetingMediaType: null,
    instructions: "",
    offerEnabled: false,
    offerText: "",
    offerMediaUrl: "",
    offerMediaType: null,
    offerStartsOn: "",
    offerEndsOn: "",
    availability: DEFAULT_AVAILABILITY,
    whatsappInstance: "",
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  state.data = null;
  state.queryError = null;
  state.tab = null;
});

describe("SettingsPage — aba pela URL", () => {
  it("mostra a falha da consulta em vez de uma configuração vazia", () => {
    state.queryError = new Error("Configurações indisponíveis");
    render(<SettingsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Configurações indisponíveis",
    );
    fireEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it("abre e acompanha ?tab=whatsapp sem remontar a página", () => {
    state.data = makeSettings();
    const { rerender } = render(<SettingsPage />);
    expect(screen.getByText("Preview do assistente")).toBeInTheDocument();

    state.tab = "whatsapp";
    rerender(<SettingsPage />);

    expect(
      screen.getByText("Configuração da conexão WhatsApp"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Preview do assistente")).toBeNull();
  });
});

describe("SettingsPage — edição do nome da empresa", () => {
  it("não apaga o que está sendo digitado quando chega um novo data (refetch)", () => {
    state.data = makeSettings({ clinicName: "Empresa Demo" });

    const { rerender } = render(<SettingsPage />);

    const input = screen.getByLabelText("Nome da empresa") as HTMLInputElement;
    expect(input.value).toBe("Empresa Demo");

    // Usuário digita um novo nome.
    fireEvent.change(input, { target: { value: "Minha Nova Empresa" } });
    expect(input.value).toBe("Minha Nova Empresa");

    // Simula um refetch/atualização da cache: MESMO conteúdo do servidor, mas
    // referência NOVA de objeto (é o que dispara o useEffect de reset).
    state.data = makeSettings({ clinicName: "Empresa Demo" });
    rerender(<SettingsPage />);

    // Com o guard `!formState.isDirty`, a digitação sobrevive.
    expect(
      (screen.getByLabelText("Nome da empresa") as HTMLInputElement).value,
    ).toBe("Minha Nova Empresa");
  });

  it("carrega o valor do servidor quando o form ainda não foi tocado", () => {
    state.data = makeSettings({ clinicName: "Empresa Inicial" });
    render(<SettingsPage />);
    expect(
      (screen.getByLabelText("Nome da empresa") as HTMLInputElement).value,
    ).toBe("Empresa Inicial");
  });
});

describe("SettingsPage — salvar com Selects preenchidos (bubble input do Radix)", () => {
  /**
   * Regressão: com o dropdown fechado, o <select> nativo escondido do Radix
   * (renderizado porque o Select está num <form>) não tem as options dos
   * SelectItem; quando o reset() do RHF muda o value programaticamente, o
   * nativo coagia para "" e o onValueChange("") corrompia o form —
   * `greetingMediaType: ""` reprovava no zodResolver e o PATCH nunca saía
   * (sem erro visível), além de apagar `specialty`. Ver o guard no
   * components/ui/select.tsx.
   */
  it("dispara o PATCH preservando specialty e greetingMediaType", async () => {
    state.data = makeSettings({
      clinicName: "Clínica Demo",
      specialty: "odontologia geral e estética",
      greetingMediaUrl: "https://cdn.example/boas-vindas.jpg",
      greetingMediaType: "image",
    });
    render(<SettingsPage />);

    const input = screen.getByLabelText("Nome da empresa") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Clínica Renomeada" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(state.update.mutate).toHaveBeenCalled());
    const [payload] = state.update.mutate.mock.calls[0] as [ClinicSettingsDto];
    expect(payload.clinicName).toBe("Clínica Renomeada");
    expect(payload.specialty).toBe("odontologia geral e estética");
    expect(payload.greetingMediaType).toBe("image");
  });
});
