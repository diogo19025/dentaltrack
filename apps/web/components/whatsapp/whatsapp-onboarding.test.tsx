import type { WhatsappConnection } from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsappConnectPanel } from "./connect-panel";
import { WhatsappOnboarding } from "./whatsapp-onboarding";

/**
 * O que estes testes protegem: a pergunta vem **antes** do QR.
 *
 * O número que ler aquele código passa a ser operado pelo bot, respondendo
 * sozinho a quem escrever. Mostrar o QR de cara faria alguém parear o número
 * pessoal sem entender o que estava aceitando.
 */

const state = vi.hoisted(() => ({
  data: null as WhatsappConnection | null,
  answer: { mutate: vi.fn(), isPending: false },
  connect: {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null as Error | null,
    data: undefined as WhatsappConnection | undefined,
  },
  disconnect: { mutate: vi.fn(), isPending: false },
  reset: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@/hooks/use-whatsapp-connection", () => ({
  useWhatsappConnection: () => ({
    data: state.data,
    isLoading: state.data === null,
  }),
  useAnswerWhatsappOnboarding: () => state.answer,
  useConnectWhatsapp: () => state.connect,
  useDisconnectWhatsapp: () => state.disconnect,
  useResetWhatsapp: () => state.reset,
}));

function connection(over: Partial<WhatsappConnection> = {}): WhatsappConnection {
  return {
    state: "nao_configurado",
    instanceName: null,
    phone: null,
    qrCode: null,
    pairingCode: null,
    onboardingAnswered: false,
    serverReady: true,
    lastError: null,
    ...over,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  state.data = null;
  state.connect.data = undefined;
  state.connect.isError = false;
});

describe("WhatsappOnboarding (pergunta do primeiro acesso)", () => {
  it("pergunta antes de mostrar qualquer QR", () => {
    state.data = connection();
    render(<WhatsappOnboarding />);

    expect(
      screen.getByText(/já tem um número dedicado/i),
    ).toBeInTheDocument();
    expect(screen.queryByAltText(/QR code/i)).toBeNull();
  });

  it("avisa para não usar o número pessoal", () => {
    state.data = connection();
    render(<WhatsappOnboarding />);

    expect(screen.getByText(/não use o seu número pessoal/i)).toBeInTheDocument();
  });

  it("não reaparece para quem já respondeu", () => {
    state.data = connection({ onboardingAnswered: true });
    const { container } = render(<WhatsappOnboarding />);

    expect(container).toBeEmptyDOMElement();
  });

  it("não aparece quando o servidor não suporta o pareamento", () => {
    // Sem Evolution/URL pública configuradas, oferecer o fluxo seria prometer
    // algo que não acontece.
    state.data = connection({ serverReady: false });
    const { container } = render(<WhatsappOnboarding />);

    expect(container).toBeEmptyDOMElement();
  });

  it('"ainda não tenho" registra a resposta e encerra o assunto', () => {
    state.data = connection();
    render(<WhatsappOnboarding />);

    fireEvent.click(screen.getByRole("button", { name: /ainda não tenho/i }));

    expect(state.answer.mutate).toHaveBeenCalledWith("nao_tem");
    expect(screen.queryByText(/já tem um número dedicado/i)).toBeNull();
  });

  it('"sim, quero conectar" leva ao pareamento', () => {
    state.data = connection();
    render(<WhatsappOnboarding />);

    fireEvent.click(screen.getByRole("button", { name: /sim, quero conectar/i }));

    expect(state.answer.mutate).toHaveBeenCalledWith("tem_numero");
    expect(screen.getByText(/Leia o QR code/i)).toBeInTheDocument();
  });
});

describe("WhatsappConnectPanel", () => {
  it("mostra o QR e o passo a passo quando há pareamento pendente", () => {
    render(
      <WhatsappConnectPanel
        connection={connection({
          state: "aguardando_leitura",
          qrCode: "data:image/png;base64,AAA",
          instanceName: "empresa-abc",
        })}
      />,
    );

    const qr = screen.getByAltText(/QR code/i) as HTMLImageElement;
    expect(qr.src).toBe("data:image/png;base64,AAA");
    expect(screen.getByText(/Aparelhos conectados/i)).toBeInTheDocument();
  });

  it("oferece o código de pareamento quando a Evolution devolve um", () => {
    render(
      <WhatsappConnectPanel
        connection={connection({
          state: "aguardando_leitura",
          qrCode: "data:image/png;base64,AAA",
          pairingCode: "ABCD-1234",
        })}
      />,
    );

    expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
  });

  it("conectado: mostra o número e as ações de desconectar/trocar", () => {
    render(
      <WhatsappConnectPanel
        connection={connection({
          state: "conectado",
          phone: "5511999998888",
          instanceName: "empresa-abc",
        })}
      />,
    );

    expect(screen.getByText("+55 (11) 99999-8888")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /desconectar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /trocar de número/i })).toBeInTheDocument();
    expect(screen.queryByAltText(/QR code/i)).toBeNull();
  });

  it("sessão caída: explica o motivo e oferece reconectar", () => {
    render(
      <WhatsappConnectPanel connection={connection({ state: "desconectado" })} />,
    );

    expect(screen.getByText(/A sessão caiu/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reconectar/i }));
    expect(state.connect.mutate).toHaveBeenCalled();
  });

  it("servidor sem WhatsApp habilitado: explica em vez de oferecer botão morto", () => {
    render(
      <WhatsappConnectPanel connection={connection({ serverReady: false })} />,
    );

    expect(screen.getByText(/não está habilitado neste servidor/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
