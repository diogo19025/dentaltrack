import type {
  AppointmentStatus,
  ExternalStatus,
  StatusMapping,
} from '@dentaltrack/shared';

/**
 * Sugestão de mapeamento `status externo → status daqui` (F9).
 *
 * Duas necessidades se encontram aqui:
 *
 * - o operador não deveria mapear quinze status na mão para começar a usar;
 * - mas um status que ninguém reconheceu **não pode** reclassificar um
 *   agendamento por conta própria.
 *
 * A saída é uma heurística por nome que só opina quando reconhece: nome não
 * reconhecido devolve `null`, que significa "não mexe". A tela de conexão
 * pré-preenche o mapeamento com estas sugestões para o operador **confirmar** —
 * é a diferença entre um palpite explícito e um palpite escondido.
 */

interface Rule {
  status: AppointmentStatus;
  patterns: RegExp[];
}

/**
 * Ordem importa: as regras mais específicas vêm primeiro. "Não compareceu"
 * contém "compareceu", e classificá-lo como presença inverteria exatamente o
 * sinal que dispara a remarcação.
 */
const RULES: Rule[] = [
  {
    status: 'faltou',
    patterns: [
      /\bfalt/,
      /nao\s*compareceu/,
      /no[\s-]?show/,
      /ausente/,
      /nao\s*veio/,
    ],
  },
  {
    status: 'cancelado',
    patterns: [/cancel/, /desmarc/, /desistiu/],
  },
  {
    status: 'compareceu',
    patterns: [
      /atendid/,
      /em\s*atendimento/,
      /sala\s*de\s*espera/,
      /chegou/,
      /conclu/,
      /finaliz/,
      /realizad/,
      /compareceu/,
      /present/,
    ],
  },
  {
    status: 'confirmado',
    patterns: [/confirmad/, /confirm/],
  },
  {
    status: 'agendado',
    patterns: [/agendad/, /marcad/, /reagendad/, /aguardando/],
  },
];

/** Nome do status → status do domínio, ou `null` se não reconhecer. */
export function suggestStatus(name: string): AppointmentStatus | null {
  const normalized = normalize(name);
  if (!normalized) return null;
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.status;
    }
  }
  return null;
}

/**
 * Mapeamento sugerido para a lista de status da conta. Preserva o que o
 * operador já decidiu: uma escolha manual nunca é sobrescrita por palpite,
 * inclusive a escolha de **ignorar** um status.
 */
export function suggestStatusMappings(
  statuses: ExternalStatus[],
  existing: StatusMapping[] = [],
): StatusMapping[] {
  const byId = new Map(existing.map((m) => [m.externalId, m]));
  return statuses.map((status) => {
    const already = byId.get(status.id);
    if (already) return { ...already, externalName: status.name };
    return {
      externalId: status.id,
      externalName: status.name,
      status: suggestStatus(status.name),
    };
  });
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
