import type { Clinic, ClinicSettings, Procedure } from "../../generated/prisma/client";

/**
 * Prompt builder (BE-1.3). Monta o system prompt da conversa a partir dos
 * dados da clínica, das configurações (opcionais) e do catálogo de procedimentos.
 * Pure function (sem I/O) — fácil de testar. Ainda sem tools/streaming.
 */
export interface BuildSystemPromptInput {
  clinic: Clinic;
  settings?: ClinicSettings | null;
  procedures: Procedure[];
}

/** Formata centavos como BRL (ex.: 150000 → "R$ 1.500"). */
function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Resumo de preço de um procedimento (faixa, mínimo ou vazio). */
function formatPrice(proc: Procedure): string | null {
  const { priceMinCents, priceMaxCents } = proc;
  if (priceMinCents != null && priceMaxCents != null) {
    return priceMinCents === priceMaxCents
      ? formatCents(priceMinCents)
      : `${formatCents(priceMinCents)} a ${formatCents(priceMaxCents)}`;
  }
  if (priceMinCents != null) return `a partir de ${formatCents(priceMinCents)}`;
  if (priceMaxCents != null) return `até ${formatCents(priceMaxCents)}`;
  return null;
}

/** Uma linha resumida do catálogo para um procedimento. */
function formatProcedure(proc: Procedure): string {
  const parts: string[] = [];
  if (proc.description) parts.push(proc.description);
  const price = formatPrice(proc);
  if (price) parts.push(`valor aproximado: ${price}`);
  if (proc.durationMinutes != null) parts.push(`duração: ~${proc.durationMinutes} min`);
  const detail = parts.length > 0 ? ` — ${parts.join("; ")}` : "";
  return `- ${proc.name}${detail}`;
}

export function buildSystemPrompt({
  clinic,
  settings,
  procedures,
}: BuildSystemPromptInput): string {
  const lines: string[] = [];

  // Identidade da clínica.
  const specialty = settings?.specialty?.trim();
  lines.push(
    `Você é o assistente virtual de atendimento da clínica odontológica "${clinic.name}"` +
      (specialty ? `, especializada em ${specialty}.` : "."),
  );
  if (settings?.description?.trim()) {
    lines.push(`Sobre a clínica: ${settings.description.trim()}`);
  }

  // Persona / tom.
  if (settings?.assistantName?.trim()) {
    lines.push(`Seu nome é ${settings.assistantName.trim()}.`);
  }
  if (settings?.tone?.trim()) {
    lines.push(`Use sempre um tom ${settings.tone.trim()} ao falar com o paciente.`);
  }

  // Saudação / instruções específicas da clínica.
  if (settings?.greeting?.trim()) {
    lines.push(`Saudação sugerida ao iniciar a conversa: "${settings.greeting.trim()}"`);
  }
  if (settings?.instructions?.trim()) {
    lines.push(`Instruções específicas da clínica: ${settings.instructions.trim()}`);
  }

  // Catálogo de procedimentos.
  lines.push("");
  if (procedures.length > 0) {
    lines.push("Catálogo de procedimentos oferecidos pela clínica:");
    for (const proc of procedures) lines.push(formatProcedure(proc));
  } else {
    lines.push(
      "A clínica ainda não cadastrou procedimentos. Não cite procedimentos ou preços específicos; ofereça uma avaliação inicial.",
    );
  }

  // Diretrizes de comportamento.
  lines.push("");
  lines.push("Diretrizes de atendimento:");
  lines.push(
    "- Responda sempre em português do Brasil, como um atendente de clínica odontológica: cordial, claro e objetivo.",
  );
  lines.push(
    "- Quando o paciente demonstrar interesse em um procedimento ou em agendar, conduza-o gentilmente a deixar o nome e o telefone para contato.",
  );
  lines.push(
    "- Não invente preços, horários ou procedimentos que não estejam no catálogo acima. Se não tiver a informação, ofereça uma avaliação presencial.",
  );
  lines.push(
    "- Quando faltar alguma informação para ajudar (qual procedimento, preferência de dia/horário, nome ou telefone), pergunte de forma simples e direta, uma coisa de cada vez.",
  );

  // Uso obrigatório das ferramentas (function calling). Sem isto o modelo
  // costuma só *dizer* que agendou, sem realmente registrar nada.
  lines.push("");
  lines.push("Ferramentas — você DEVE usá-las de verdade, nunca apenas dizer que usou:");
  lines.push(
    "- Para falar de procedimentos, preços ou duração, chame `searchProcedures` (ou `suggestProcedures`) e responda com base no resultado. Nunca invente.",
  );
  lines.push(
    "- Assim que tiver o nome e o telefone do paciente, chame `captureLead` para registrar o contato.",
  );
  lines.push(
    "- Quando o paciente confirmar que quer marcar, chame `bookAppointment` com o procedimento e a preferência de dia/horário. Só confirme o agendamento DEPOIS que a ferramenta retornar sucesso.",
  );
  lines.push(
    "- Não afirme que registrou contato ou agendamento se você não chamou a ferramenta correspondente.",
  );

  return lines.join("\n");
}
