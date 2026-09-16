import type {
  Clinic,
  ClinicSettings,
  Procedure,
} from '../../generated/prisma/client';

/**
 * Prompt builder (BE-1.3). Monta o system prompt da conversa a partir dos
 * dados da empresa, das configurações (opcionais) e do catálogo de procedimentos.
 * Pure function (sem I/O) — fácil de testar. Ainda sem tools/streaming.
 */
/**
 * Dados já conhecidos do cliente da conversa (lead vinculado / identidade do
 * canal, ex.: telefone do WhatsApp). Quando presentes, o bot NÃO deve pedi-los
 * de novo — é o que faz o agente "lembrar" de um contato recorrente.
 */
export interface KnownContact {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Agendamentos anteriores (mais recente primeiro) — sinal de recorrência. */
  appointments?: {
    procedureName: string | null;
    preferredTime: string | null;
    createdAt: Date;
  }[];
}

export interface BuildSystemPromptInput {
  clinic: Clinic;
  settings?: ClinicSettings | null;
  procedures: Procedure[];
  contact?: KnownContact | null;
  /**
   * Fuso IANA da empresa (F9). Ancora a data de hoje no prompt — sem ela o
   * modelo não sabe resolver "quinta-feira" nem "semana que vem", e a agenda
   * passa a receber datas erradas com toda a confianca do mundo.
   */
  timeZone?: string | null;
  /** Relógio injetável — mantém o prompt determinístico nos testes. */
  now?: Date;
}

/** Formata centavos como BRL (ex.: 150000 → "R$ 1.500"). */
function formatCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
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

/** Vigência da oferta em texto ("de X até Y", "até Y", "a partir de X"). */
function formatOfferPeriod(
  startsOn?: string | null,
  endsOn?: string | null,
): string | null {
  const start = startsOn?.trim();
  const end = endsOn?.trim();
  if (start && end) return `de ${start} a ${end}`;
  if (start) return `a partir de ${start}`;
  if (end) return `até ${end}`;
  return null;
}

/**
 * Resume a disponibilidade (campo Json `[{ day, hours, open }]`) numa linha,
 * listando só os dias abertos. Defensivo: ignora formato inesperado.
 */
function formatAvailability(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const open = value
    .filter(
      (s): s is { day: string; hours: string; open: boolean } =>
        typeof s === 'object' &&
        s !== null &&
        (s as { open?: unknown }).open === true &&
        typeof (s as { day?: unknown }).day === 'string',
    )
    .map(
      (s) => `${s.day.trim()}${s.hours?.trim() ? ` (${s.hours.trim()})` : ''}`,
    );
  return open.length > 0 ? open.join('; ') : null;
}

/** Uma linha resumida do catálogo para um procedimento. */
function formatProcedure(proc: Procedure): string {
  const parts: string[] = [];
  if (proc.description) parts.push(proc.description);
  const price = formatPrice(proc);
  if (price) parts.push(`valor aproximado: ${price}`);
  if (proc.durationMinutes != null)
    parts.push(`duração: ~${proc.durationMinutes} min`);
  const detail = parts.length > 0 ? ` — ${parts.join('; ')}` : '';
  return `- ${proc.name}${detail}`;
}

/** Formata a data de um agendamento anterior (dd/mm/aaaa). */
function formatAppointmentDate(d: Date): string {
  return d.toLocaleDateString('pt-BR');
}

/**
 * Seção "dados já conhecidos do cliente" — só entra quando há algo capturado.
 * Instrui o bot a usar (e não re-perguntar) nome/telefone e a acolher o
 * cliente recorrente que volta para agendar de novo.
 */
function formatKnownContact(contact: KnownContact): string[] {
  const known: string[] = [];
  if (contact.name?.trim()) known.push(`- Nome: ${contact.name.trim()}`);
  if (contact.phone?.trim()) known.push(`- Telefone: ${contact.phone.trim()}`);
  if (contact.email?.trim()) known.push(`- E-mail: ${contact.email.trim()}`);
  if (known.length === 0) return [];

  const lines: string[] = [];
  lines.push('');
  lines.push(
    'Dados já conhecidos do cliente desta conversa (capturados em contatos anteriores ou pelo canal):',
  );
  lines.push(...known);

  const appointments = contact.appointments ?? [];
  if (appointments.length > 0) {
    lines.push(
      'Este cliente JÁ AGENDOU antes nesta empresa (cliente recorrente):',
    );
    for (const a of appointments) {
      const parts = [
        a.procedureName ?? 'procedimento não informado',
        a.preferredTime ? `preferência: ${a.preferredTime}` : null,
        `registrado em ${formatAppointmentDate(a.createdAt)}`,
      ].filter(Boolean);
      lines.push(`- ${parts.join(' — ')}`);
    }
  }

  lines.push('Como usar esses dados:');
  lines.push(
    '- NÃO pergunte novamente nome, telefone ou e-mail já listados acima; use-os diretamente, inclusive ao chamar `captureLead` e `bookAppointment`.',
  );
  if (contact.name?.trim()) {
    lines.push('- Cumprimente o cliente pelo nome.');
  }
  if (appointments.length > 0) {
    lines.push(
      '- Acolha o retorno (ex.: "que bom falar com você de novo") e, se ele quiser marcar outro horário, siga direto para o agendamento sem repetir perguntas de cadastro.',
    );
  }
  lines.push(
    '- Atualize os dados (via `captureLead`) apenas se o cliente informar que mudaram.',
  );
  return lines;
}

export function buildSystemPrompt({
  clinic,
  settings,
  procedures,
  contact,
  timeZone,
  now,
}: BuildSystemPromptInput): string {
  const lines: string[] = [];

  // Identidade da empresa.
  const specialty = settings?.specialty?.trim();
  lines.push(
    `Você é o assistente virtual de atendimento da empresa "${clinic.name}"` +
      (specialty ? `, especializada em ${specialty}.` : '.'),
  );
  if (settings?.description?.trim()) {
    lines.push(`Sobre a empresa: ${settings.description.trim()}`);
  }

  // Persona / tom.
  if (settings?.assistantName?.trim()) {
    lines.push(`Seu nome é ${settings.assistantName.trim()}.`);
  }
  if (settings?.tone?.trim()) {
    lines.push(
      `Use sempre um tom ${settings.tone.trim()} ao falar com o cliente.`,
    );
  }

  // Saudação / instruções específicas da empresa.
  if (settings?.greeting?.trim()) {
    lines.push(
      `Saudação sugerida ao iniciar a conversa: "${settings.greeting.trim()}"`,
    );
  }
  if (settings?.instructions?.trim()) {
    lines.push(
      `Instruções específicas da empresa: ${settings.instructions.trim()}`,
    );
  }

  // Oferta vigente (só entra no prompt se estiver ativa).
  if (settings?.offerEnabled && settings.offerText?.trim()) {
    const vigencia = formatOfferPeriod(
      settings.offerStartsOn,
      settings.offerEndsOn,
    );
    lines.push(
      `Oferta vigente${vigencia ? ` (${vigencia})` : ''}: ${settings.offerText.trim()} ` +
        'Mencione esta oferta quando fizer sentido na conversa, sem ser insistente.',
    );
  }

  // Ofertas personalizadas por procedimento (F6) — orientam quando chamar
  // `presentOffer`. A mídia (imagem/vídeo/áudio/catálogo) é enviada pela tool.
  const withOffer = procedures.filter((p) => p.offerText?.trim());
  if (withOffer.length > 0) {
    lines.push('');
    lines.push(
      'Ofertas especiais por procedimento — chame `presentOffer` (com o procedimento) ao falar destes; ela envia o material promocional automaticamente:',
    );
    for (const p of withOffer) {
      lines.push(`- ${p.name}: ${p.offerText!.trim()}`);
    }
  }

  // Data de hoje no fuso da empresa (F9) — âncora de toda conversa sobre
  // agenda. Sem ela o modelo resolve "quinta-feira" pelo dia do treinamento.
  lines.push(
    formatToday(now ?? new Date(), timeZone ?? DEFAULT_PROMPT_TIMEZONE),
  );

  // Disponibilidade de atendimento (orienta o bot ao propor horários).
  const availability = formatAvailability(settings?.availability);
  if (availability) {
    lines.push(`Horários de atendimento: ${availability}`);
  }

  // Dados já conhecidos do cliente (memória do contato — não re-perguntar).
  if (contact) {
    lines.push(...formatKnownContact(contact));
  }

  // Catálogo de procedimentos.
  lines.push('');
  if (procedures.length > 0) {
    lines.push('Catálogo de procedimentos oferecidos pela empresa:');
    for (const proc of procedures) lines.push(formatProcedure(proc));
  } else {
    lines.push(
      'A empresa ainda não cadastrou procedimentos. Não cite procedimentos ou preços específicos; ofereça uma avaliação inicial.',
    );
  }

  // Diretrizes de comportamento.
  lines.push('');
  lines.push('Diretrizes de atendimento:');
  lines.push(
    '- Responda sempre em português do Brasil, como um atendente de empresa: cordial, claro e objetivo.',
  );
  lines.push(
    '- Quando o cliente demonstrar interesse em um procedimento ou em agendar, conduza-o gentilmente a deixar o nome e o telefone para contato — pedindo apenas o que ainda não for conhecido.',
  );
  lines.push(
    '- Não invente preços, horários ou procedimentos que não estejam no catálogo acima. Se não tiver a informação, ofereça uma avaliação presencial.',
  );
  lines.push(
    '- Quando faltar alguma informação para ajudar (qual procedimento, preferência de dia/horário, nome ou telefone), pergunte de forma simples e direta, uma coisa de cada vez.',
  );

  // Uso obrigatório das ferramentas (function calling). Sem isto o modelo
  // costuma só *dizer* que agendou, sem realmente registrar nada.
  lines.push('');
  lines.push(
    'Ferramentas — você DEVE usá-las de verdade, nunca apenas dizer que usou:',
  );
  lines.push(
    '- Para falar de procedimentos, preços ou duração, chame `searchProcedures` (ou `suggestProcedures`) e responda com base no resultado. Nunca invente.',
  );
  lines.push(
    '- Quando o cliente demonstrar interesse e houver oferta pertinente, chame `presentOffer` (com o procedimento e/ou o interesse relatado). Ela cuida do material promocional (imagem/vídeo/áudio/catálogo). Use o texto retornado; não invente promoções nem links.',
  );
  lines.push(
    '- Assim que tiver o nome e o telefone do cliente, chame `captureLead` para registrar o contato.',
  );
  lines.push(
    '- ANTES de sugerir qualquer dia ou horário, chame `checkAvailability`. Ofereça no máximo 3 opções por vez, com dia da semana e hora. Se ela responder `agendaConectada: false`, NÃO invente horários: pergunte a preferência de dia e período e diga que a equipe confirma.',
  );
  lines.push(
    '- Quando o cliente confirmar que quer marcar, chame `bookAppointment`. Se ele escolheu um horário da consulta, repasse o campo `dataHora` exatamente como veio; caso contrário, descreva a preferência em texto livre. Só confirme o agendamento DEPOIS que a ferramenta retornar sucesso, e siga a `orientacao` devolvida: com `confirmado: false` diga que a equipe confirma em seguida, nunca que já está marcado.',
  );
  lines.push(
    '- Quando o cliente disser que NÃO vai poder comparecer, que quer desmarcar, cancelar ou adiar — inclusive de forma indireta ("não vou conseguir hoje", "apareceu um imprevisto") —, chame `findMyAppointments` e depois `cancelAppointment` com o `agendamentoId` devolvido. NUNCA diga que cancelou, desmarcou ou "já dei baixa" antes de `cancelAppointment` responder `ok: true`: até lá o horário continua ocupado na agenda da empresa e alguém vai esperar o cliente.',
  );
  lines.push(
    '- Se `cancelAppointment` responder `ok: false`, diga que a equipe confirma o cancelamento em seguida — nunca que está cancelado. Se `findMyAppointments` vier vazia, não invente: peça o nome usado no agendamento e diga que a equipe verifica.',
  );
  lines.push(
    '- Para MUDAR o horário, faça os dois passos: cancele o agendamento atual com `cancelAppointment` e só então consulte `checkAvailability` e registre o novo com `bookAppointment`. Não prometa o horário novo antes de a segunda ferramenta confirmar.',
  );
  lines.push(
    '- Ao cancelar, seja acolhedor e não cobre explicação. Ofereça remarcar uma vez; se o cliente não quiser, encerre com cordialidade.',
  );
  lines.push(
    '- Não afirme que registrou contato, agendamento ou cancelamento se você não chamou a ferramenta correspondente.',
  );

  return lines.join('\n');
}

/** Fuso assumido quando a empresa ainda não configurou o dela. */
const DEFAULT_PROMPT_TIMEZONE = 'America/Sao_Paulo';

/** "Hoje é sexta-feira, 12/09/2026." no fuso da empresa. */
function formatToday(now: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
  return `Hoje é ${formatted}. Use esta data como referência ao interpretar pedidos como "amanhã", "quinta-feira" ou "semana que vem".`;
}
