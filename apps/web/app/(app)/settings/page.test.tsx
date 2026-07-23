import { DEFAULT_AVAILABILITY, type ClinicSettingsDto } from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
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
  update: {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  },
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ data: state.data, isLoading: state.data === null }),
  useUpdateSettings: () => state.update,
}));

// A sidebar/topbar não entram aqui; os hooks de leads/pipeline usados por elas
// não são exercitados nesta página, mas os filhos de outras abas importam hooks
// — a aba padrão ("identidade") não os renderiza, então não precisam de mock.

function makeSettings(over: Partial<ClinicSettingsDto> = {}): ClinicSettingsDto {
  return {
    clinicName: "Empresa Demo",
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
