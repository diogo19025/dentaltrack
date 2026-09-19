import { fireEvent, render, screen } from "@testing-library/react";
import type { AppointmentSummary } from "@dentaltrack/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCancelAppointment,
  useRescheduleAppointment,
} from "@/hooks/use-agenda";
import { ApiError } from "@/lib/api-client";
import { AppointmentDetailDialog } from "./appointment-detail-dialog";

vi.mock("@/hooks/use-agenda", () => ({
  useCancelAppointment: vi.fn(),
  useRescheduleAppointment: vi.fn(),
}));

// Caixas que buscam na rede ao abrir; têm testes próprios no dashboard.
vi.mock("@/components/dashboard/send-reminder-dialog", () => ({
  SendReminderDialog: ({ conversationId }: { conversationId: string }) => (
    <div role="dialog" aria-label="Enviar lembrete">
      lembrete para {conversationId}
    </div>
  ),
}));
vi.mock("@/components/dashboard/conversation-detail-dialog", () => ({
  ConversationDetailDialog: () => null,
}));

const mockCancel = vi.mocked(useCancelAppointment);
const mockReschedule = vi.mocked(useRescheduleAppointment);

type Cancel = ReturnType<typeof useCancelAppointment>;
type Reschedule = ReturnType<typeof useRescheduleAppointment>;
function mutation<T>(partial: Record<string, unknown> = {}): T {
  return {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...partial,
  } as unknown as T;
}

const appointment = (
  overrides: Partial<AppointmentSummary> = {},
): AppointmentSummary => ({
  id: "11111111-1111-1111-1111-111111111111",
  status: "agendado",
  source: "integracao",
  startsAt: "2026-10-01T13:00:00.000Z",
  endsAt: "2026-10-01T14:00:00.000Z",
  preferredTime: null,
  procedureName: "Implante",
  professionalName: "Dra. Ana",
  professionalId: null,
  leadId: null,
  leadName: "Ana Silva",
  leadPhone: null,
  conversationId: null,
  externalId: "ext-9",
  canceledAt: null,
  createdAt: "2026-09-09T12:00:00.000Z",
  ...overrides,
});

function open(a: AppointmentSummary) {
  return render(
    <AppointmentDetailDialog
      appointment={a}
      color="var(--chart-2)"
      onOpenChange={vi.fn()}
    />,
  );
}

describe("AppointmentDetailDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCancel.mockReturnValue(mutation<Cancel>());
    mockReschedule.mockReturnValue(mutation<Reschedule>());
  });

  it("mostra procedimento, cliente, profissional, horário e origem", () => {
    open(appointment());

    expect(
      screen.getByRole("heading", { name: "Implante" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Veio do sistema de gestão")).toBeInTheDocument();
    expect(screen.getAllByText("Ana Silva").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dra. Ana").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 h/)).toBeInTheDocument();
    expect(screen.getByText("ext-9")).toBeInTheDocument();
  });

  it("sem telefone nem conversa, explica por que não dá para falar com o cliente", () => {
    open(appointment());

    expect(
      screen.queryByRole("link", { name: /Conversar no WhatsApp/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Enviar lembrete/ }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Sem telefone nem conversa vinculada/),
    ).toBeInTheDocument();
  });

  it("com telefone, abre o WhatsApp do contato; com conversa, envia lembrete e abre a conversa", () => {
    open(
      appointment({
        leadPhone: "11 98888-7777",
        conversationId: "22222222-2222-2222-2222-222222222222",
      }),
    );

    expect(
      screen.getByRole("link", { name: /Conversar no WhatsApp/ }),
    ).toHaveAttribute("href", "https://wa.me/5511988887777");
    expect(
      screen.getByRole("button", { name: /Ver conversa/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Enviar lembrete/ }));
    expect(
      screen.getByRole("dialog", { name: "Enviar lembrete" }),
    ).toHaveTextContent("lembrete para 22222222-2222-2222-2222-222222222222");
  });

  it.each(["cancelado", "compareceu"] as const)(
    "não oferece remarcar nem cancelar para agendamento %s",
    (status) => {
      open(appointment({ status }));
      expect(screen.queryByRole("button", { name: /Remarcar/ })).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Cancelar agendamento/ }),
      ).toBeNull();
    },
  );

  it("cancelar pede confirmação antes de chamar a API", () => {
    const mutate = vi.fn();
    mockCancel.mockReturnValue(mutation<Cancel>({ mutate }));
    open(appointment());

    fireEvent.click(
      screen.getByRole("button", { name: /Cancelar agendamento/ }),
    );

    // Nada saiu ainda: o dialog é a confirmação.
    expect(mutate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Cancelar este agendamento?" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Cancelar agendamento" }),
    );
    expect(mutate).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      expect.any(Object),
    );
  });

  it("remarcar envia o novo horário em ISO", () => {
    const mutate = vi.fn();
    mockReschedule.mockReturnValue(mutation<Reschedule>({ mutate }));
    open(appointment());

    fireEvent.click(screen.getByRole("button", { name: /^Remarcar$/ }));

    const input = screen.getByLabelText("Novo horário");
    fireEvent.change(input, { target: { value: "2026-10-02T10:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Remarcar" }));

    expect(mutate).toHaveBeenCalledWith(
      {
        id: "11111111-1111-1111-1111-111111111111",
        startsAt: new Date("2026-10-02T10:30").toISOString(),
      },
      expect.any(Object),
    );
  });

  it("mostra a resposta da agenda da empresa quando ela recusa", () => {
    mockReschedule.mockReturnValue(
      mutation<Reschedule>({
        isError: true,
        error: new ApiError(
          503,
          JSON.stringify({
            statusCode: 503,
            message:
              "A agenda da empresa não aceitou remarcar agora: Google 503",
          }),
          "req-1",
        ),
      }),
    );
    open(appointment());

    fireEvent.click(screen.getByRole("button", { name: /^Remarcar$/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "A agenda da empresa não aceitou remarcar agora: Google 503 (código req-1)",
    );
  });
});
