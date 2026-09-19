import { fireEvent, render, screen } from "@testing-library/react";
import type { AppointmentSummary } from "@dentaltrack/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCancelAppointment,
  useRescheduleAppointment,
} from "@/hooks/use-agenda";
import { ApiError } from "@/lib/api-client";
import { AppointmentActions } from "./appointment-actions";

vi.mock("@/hooks/use-agenda", () => ({
  useCancelAppointment: vi.fn(),
  useRescheduleAppointment: vi.fn(),
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

const openMenu = () =>
  fireEvent.keyDown(screen.getByLabelText("Ações do agendamento"), {
    key: "ArrowDown",
  });

describe("AppointmentActions (cancelar / remarcar · P0.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCancel.mockReturnValue(mutation<Cancel>());
    mockReschedule.mockReturnValue(mutation<Reschedule>());
  });

  it.each(["cancelado", "compareceu"] as const)(
    "não oferece ações para agendamento %s",
    (status) => {
      render(<AppointmentActions appointment={appointment({ status })} />);
      expect(screen.queryByLabelText("Ações do agendamento")).toBeNull();
    },
  );

  it("cancelar pede confirmação antes de chamar a API", () => {
    const mutate = vi.fn();
    mockCancel.mockReturnValue(mutation<Cancel>({ mutate }));
    render(<AppointmentActions appointment={appointment()} />);

    openMenu();
    fireEvent.click(screen.getByText("Cancelar agendamento…"));

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
    render(<AppointmentActions appointment={appointment()} />);

    openMenu();
    fireEvent.click(screen.getByText("Remarcar…"));

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
            message: "A agenda da empresa não aceitou remarcar agora: Google 503",
          }),
          "req-1",
        ),
      }),
    );
    render(<AppointmentActions appointment={appointment()} />);

    openMenu();
    fireEvent.click(screen.getByText("Remarcar…"));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "A agenda da empresa não aceitou remarcar agora: Google 503 (código req-1)",
    );
  });
});
