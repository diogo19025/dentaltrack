import type { WhatsappConnection } from "@dentaltrack/shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
    /** Instante em que o QR atual foi pedido — âncora da contagem regressiva. */
    submittedAt: 0,
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
  state.connect.submittedAt = 0;
  vi.useRealTimers();
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

describe("WhatsappConnectPanel — validade do QR", () => {
  /** Um QR recém-gerado, ancorado no relógio falso. */
  function freshQr(issuedAt: number) {
    const pending = connection({
      state: "aguardando_leitura",
      qrCode: "data:image/png;base64,AAA",
    });
    state.connect.data = pending;
    state.connect.submittedAt = issuedAt;
    return pending;
  }

  it("mostra quanto tempo falta para o código expirar", () => {
    // O dono precisa saber se ainda dá tempo de pegar o celular, em vez de
    // descobrir que o código morreu só depois de apontar a câmera.
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);

    render(<WhatsappConnectPanel connection={freshQr(t0)} />);

    expect(screen.getByText("0:40")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(35_000);
    });
    expect(screen.getByText("0:05")).toBeInTheDocument();
  });

  it("ao expirar, avisa e destaca o botão de gerar um novo", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);

    render(<WhatsappConnectPanel connection={freshQr(t0)} />);

    act(() => {
      vi.advanceTimersByTime(41_000);
    });

    expect(screen.getByText(/Código expirado/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Gerar novo QR code/i }),
    ).toBeInTheDocument();
  });

  it("renova o código sozinho antes de ele morrer", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);

    render(<WhatsappConnectPanel connection={freshQr(t0)} />);
    expect(state.connect.mutate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(40_000);
    });
    expect(state.connect.mutate).toHaveBeenCalled();
  });

  it("o botão de gerar outro código está disponível antes de expirar", () => {
    render(
      <WhatsappConnectPanel
        connection={connection({
          state: "aguardando_leitura",
          qrCode: "data:image/png;base64,AAA",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Gerar outro código/i }));
    expect(state.connect.mutate).toHaveBeenCalled();
  });

  it("o QR não some se a consulta de estado oscilar durante a espera", () => {
    // A Evolution reporta `close` entre gerar o código e alguém lê-lo. Sumir
    // com o QR bem nesse momento seria o pior desfecho possível.
    state.connect.data = connection({
      state: "aguardando_leitura",
      qrCode: "data:image/png;base64,AAA",
    });

    render(
      <WhatsappConnectPanel connection={connection({ state: "desconectado" })} />,
    );

    expect(screen.getByAltText(/QR code/i)).toBeInTheDocument();
  });
});
