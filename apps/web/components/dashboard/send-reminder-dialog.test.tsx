import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReminderContext, useSendReminder } from "@/hooks/use-reminders";
import { SendReminderDialog } from "./send-reminder-dialog";

vi.mock("@/hooks/use-reminders", () => ({
  useReminderContext: vi.fn(),
  useSendReminder: vi.fn(),
}));

const mockCtx = vi.mocked(useReminderContext);
const mockSend = vi.mocked(useSendReminder);

type Ctx = ReturnType<typeof useReminderContext>;
type Send = ReturnType<typeof useSendReminder>;

const ctxResult = (partial: Partial<Ctx>) =>
  ({ data: undefined, isLoading: false, isError: false, ...partial }) as Ctx;

const sendResult = (partial: Partial<Send> = {}) =>
  ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    ...partial,
  }) as unknown as Send;

const submitButton = () =>
  screen.getByRole("button", { name: /^enviar lembrete$/i });

describe("SendReminderDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pré-preenche o rascunho do servidor e envia o texto no submit", () => {
    const mutate = vi.fn();
    mockCtx.mockReturnValue(
      ctxResult({
        data: {
          canSend: true,
          reason: null,
          phone: "5511999998888",
          draft: "Olá, Maria! Vamos agendar?",
        },
      }),
    );
    mockSend.mockReturnValue(sendResult({ mutate }));

    render(
      <SendReminderDialog
        conversationId="c-1"
        contactName="Maria Silva"
        open
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("Mensagem")).toHaveValue(
      "Olá, Maria! Vamos agendar?",
    );

    fireEvent.click(submitButton());
    expect(mutate).toHaveBeenCalledWith("Olá, Maria! Vamos agendar?");
  });

  it("bloqueado (sem telefone): mostra a ajuda e desabilita o envio", () => {
    mockCtx.mockReturnValue(
      ctxResult({
        data: {
          canSend: false,
          reason: "no_phone",
          phone: null,
          draft: "Olá!",
        },
      }),
    );
    mockSend.mockReturnValue(sendResult());

    render(
      <SendReminderDialog conversationId="c-1" open onOpenChange={() => {}} />,
    );

    expect(screen.getByText(/não tem telefone capturado/i)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("WhatsApp não configurado: aponta para as Configurações", () => {
    mockCtx.mockReturnValue(
      ctxResult({
        data: {
          canSend: false,
          reason: "whatsapp_not_configured",
          phone: "5511999998888",
          draft: "Olá!",
        },
      }),
    );
    mockSend.mockReturnValue(sendResult());

    render(
      <SendReminderDialog conversationId="c-1" open onOpenChange={() => {}} />,
    );

    expect(
      screen.getByText(/Conecte o WhatsApp da empresa/i),
    ).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("após enviar, mostra a confirmação com o nome do contato", () => {
    mockCtx.mockReturnValue(
      ctxResult({
        data: {
          canSend: true,
          reason: null,
          phone: "5511999998888",
          draft: "Olá!",
        },
      }),
    );
    mockSend.mockReturnValue(sendResult({ isSuccess: true }));

    render(
      <SendReminderDialog
        conversationId="c-1"
        contactName="Maria Silva"
        open
        onOpenChange={() => {}}
      />,
    );

    expect(
      screen.getByText("Lembrete enviado para Maria."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fechar/i })).toBeInTheDocument();
  });

  it("no handoff vira uma caixa de resposta vazia com rótulos próprios", () => {
    const mutate = vi.fn();
    mockCtx.mockReturnValue(
      ctxResult({
        data: {
          canSend: true,
          reason: null,
          phone: "5511999998888",
          draft: "Este rascunho não deve entrar na resposta.",
        },
      }),
    );
    mockSend.mockReturnValue(sendResult({ mutate }));

    render(
      <SendReminderDialog
        conversationId="c-1"
        purpose="reply"
        open
        onOpenChange={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Responder cliente" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Mensagem"), {
      target: { value: "Vou verificar para você." },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar resposta/i }));
    expect(mutate).toHaveBeenCalledWith("Vou verificar para você.");
  });
});
