import type { AppointmentSummary, ProfessionalDto } from "@dentaltrack/shared";

/**
 * A cor de um agendamento é **sempre a do profissional** que atende. É o que a
 * recepção precisa ver de relance na grade; o procedimento fica no texto do
 * bloco e no filtro. Sem profissional (empresa sem cadastro, ou histórico
 * anterior a ele), cai na cor primária.
 */

/** Cor neutra para agendamento sem profissional resolvido. */
export const NEUTRAL_COLOR = "var(--primary)";

/** Tamanho da paleta (`--chart-1..8` no globals.css). */
export const PALETTE_SIZE = 8;

/**
 * Cor estável por profissional: a posição na lista (ordem de entrada, que a
 * API devolve de propósito) escolhe a cor da paleta de charts, então ninguém
 * muda de cor quando alguém entra ou sai da equipe.
 */
export function professionalColor(
  professional: ProfessionalDto | null,
  all: ProfessionalDto[],
): string {
  if (!professional) return NEUTRAL_COLOR;
  const index = all.findIndex((p) => p.id === professional.id);
  if (index < 0) return NEUTRAL_COLOR;
  return `var(--chart-${(index % PALETTE_SIZE) + 1})`;
}

/**
 * Resolve o profissional de um agendamento: pela chave (F20) e, no histórico
 * anterior ao cadastro, pelo nome que a sincronização gravou.
 */
export function professionalResolver(
  professionals: ProfessionalDto[],
): (appointment: AppointmentSummary) => ProfessionalDto | null {
  const byId = new Map(professionals.map((p) => [p.id, p]));
  const byName = new Map(professionals.map((p) => [p.name, p]));
  return (appointment) =>
    (appointment.professionalId
      ? byId.get(appointment.professionalId)
      : null) ??
    (appointment.professionalName
      ? byName.get(appointment.professionalName)
      : null) ??
    null;
}

/** Cor de um agendamento, dado o cadastro da equipe. */
export function appointmentColor(
  appointment: AppointmentSummary,
  professionals: ProfessionalDto[],
): string {
  return professionalColor(
    professionalResolver(professionals)(appointment),
    professionals,
  );
}
