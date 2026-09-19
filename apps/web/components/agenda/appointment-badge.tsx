import {
  APPOINTMENT_STATUS_LABELS,
  type AppointmentStatus,
} from "@dentaltrack/shared";
import { cn } from "@/lib/utils";

/** Situação do agendamento, com as cores já existentes de status. */
export function AppointmentBadge({
  status,
  className,
}: {
  status: AppointmentStatus;
  className?: string;
}) {
  const tone =
    status === "faltou" || status === "cancelado"
      ? "status-abandonada"
      : status === "compareceu" || status === "confirmado"
        ? "status-agendada"
        : "status-em_andamento";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[5px] text-[12px] font-medium",
        tone,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {APPOINTMENT_STATUS_LABELS[status]}
    </span>
  );
}
