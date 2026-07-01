import { type ToolSet, dynamicTool, jsonSchema } from 'ai';
import type { Channel } from '@dentaltrack/shared';
import type { ConversationsService } from '../conversations/conversations.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Tools do agente (BE-1.4) — function calling via Vercel AI SDK.
 * São construídas por requisição, capturando o contexto (clínica + conversa),
 * então cada execução já é escopada por `clinicId`. Channel-agnostic.
 *
 * Usamos `dynamicTool` + `jsonSchema` (em vez de `tool`/`zodSchema`) de propósito:
 * a ponte de tipos zod↔AI-SDK instancia tipos "excessively deep" (TS2589) e
 * estoura a memória do `tsc`. JSON Schema puro mantém o type-checker leve; a
 * validação da entrada continua sendo feita pelo SDK contra o schema.
 */
export interface ChatToolsContext {
  prisma: PrismaService;
  conversations: ConversationsService;
  clinicId: string;
  conversationId: string;
  /** Canal da conversa — vira o `source` do lead criado pelas tools. */
  channel?: Channel;
}

interface SearchInput {
  query: string;
}
interface SuggestInput {
  interesse: string;
}
interface CaptureLeadInput {
  nome: string;
  telefone?: string;
  email?: string;
}
interface BookInput {
  nome?: string;
  telefone?: string;
  procedimento?: string;
  preferencia?: string;
}

/** Formata centavos em BRL (ex.: 150000 → "R$ 1.500"). */
function brl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function priceLabel(
  min: number | null,
  max: number | null,
): string | undefined {
  if (min != null && max != null)
    return min === max ? brl(min) : `${brl(min)} a ${brl(max)}`;
  if (min != null) return `a partir de ${brl(min)}`;
  if (max != null) return `até ${brl(max)}`;
  return undefined;
}

interface ProcedureRow {
  id: string;
  name: string;
  description: string | null;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  durationMinutes: number | null;
  tags: { name: string }[];
}

function toView(p: ProcedureRow) {
  return {
    id: p.id,
    nome: p.name,
    descricao: p.description,
    preco: priceLabel(p.priceMinCents, p.priceMaxCents),
    duracaoMin: p.durationMinutes,
    tags: p.tags.map((t) => t.name),
  };
}

/** Constrói o conjunto de tools para uma conversa específica. */
export function buildChatTools(ctx: ChatToolsContext): ToolSet {
  const { prisma, conversations, clinicId, conversationId } = ctx;
  const channel: Channel = ctx.channel ?? 'web';

  async function findProcedures(query?: string, take = 5) {
    const q = query?.trim();
    const rows: ProcedureRow[] = await prisma.procedure.findMany({
      where: {
        clinicId,
        active: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take,
      include: { tags: { select: { name: true } } },
    });
    return rows.map(toView);
  }

  /**
   * Sugestão por interesse: combina a busca textual com os procedimentos cujas
   * TAGS de interesse casam com o relato do paciente (nome da tag ou alguma
   * keyword aparece no texto). As tags são poucas por clínica, então buscá-las
   * todas e filtrar em memória é barato — e é o elo tags↔procedimentos (BE-2.2).
   */
  async function suggestByInterest(interesse: string) {
    const text = interesse.toLowerCase();
    const tags = await prisma.tag.findMany({
      where: { clinicId },
      select: { id: true, name: true, keywords: true },
    });
    const matchedTagIds = tags
      .filter(
        (t) =>
          text.includes(t.name.toLowerCase()) ||
          t.keywords.some((k) => k && text.includes(k.toLowerCase())),
      )
      .map((t) => t.id);

    let byTags: ReturnType<typeof toView>[] = [];
    if (matchedTagIds.length > 0) {
      const rows: ProcedureRow[] = await prisma.procedure.findMany({
        where: {
          clinicId,
          active: true,
          tags: { some: { id: { in: matchedTagIds } } },
        },
        orderBy: { name: 'asc' },
        take: 5,
        include: { tags: { select: { name: true } } },
      });
      byTags = rows.map(toView);
    }

    // Tags primeiro (mais específico), depois a busca textual; dedup por id.
    const seen = new Set<string>();
    const combined = [...byTags, ...(await findProcedures(interesse))].filter(
      (p) => (seen.has(p.id) ? false : (seen.add(p.id), true)),
    );
    // Fallback: nada casou → mostra o catálogo geral (comportamento anterior).
    return combined.length > 0
      ? combined.slice(0, 5)
      : findProcedures(undefined);
  }

  // Tipar como Record<string, unknown> evita o tsc comparar cada tool contra os
  // tipos genéricos pesados do AI SDK. Runtime inalterado.
  const tools: Record<string, unknown> = {
    searchProcedures: dynamicTool({
      description:
        "Busca procedimentos no catálogo da clínica por um termo (ex.: 'implante', 'clareamento'). Use para responder sobre descrição, preço e duração. Não invente procedimentos fora do catálogo.",
      inputSchema: jsonSchema<SearchInput>({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Termo de busca.' },
        },
        required: ['query'],
        additionalProperties: false,
      }),
      execute: async (input) => {
        const { query } = input as SearchInput;
        const procedures = await findProcedures(query);
        return { procedures, total: procedures.length };
      },
    }),

    suggestProcedures: dynamicTool({
      description:
        "Sugere procedimentos do catálogo com base no interesse/sintoma relatado pelo paciente (ex.: 'dente amarelo', 'dor'). Retorna opções pertinentes para recomendar.",
      inputSchema: jsonSchema<SuggestInput>({
        type: 'object',
        properties: {
          interesse: {
            type: 'string',
            description: 'O que o paciente quer/relata.',
          },
        },
        required: ['interesse'],
        additionalProperties: false,
      }),
      execute: async (input) => {
        const { interesse } = input as SuggestInput;
        const procedures = await suggestByInterest(interesse);
        return { procedures, total: procedures.length };
      },
    }),

    captureLead: dynamicTool({
      description:
        'Registra (ou atualiza) os dados de contato do paciente quando ele demonstrar interesse. Chame assim que tiver o nome e, de preferência, o telefone.',
      inputSchema: jsonSchema<CaptureLeadInput>({
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome do paciente.' },
          telefone: {
            type: 'string',
            description: 'Telefone/WhatsApp, se informado.',
          },
          email: { type: 'string', description: 'E-mail, se informado.' },
        },
        required: ['nome'],
        additionalProperties: false,
      }),
      execute: async (input) => {
        const { nome, telefone, email } = input as CaptureLeadInput;
        try {
          const leadId = await upsertLead(prisma, {
            clinicId,
            conversationId,
            nome,
            telefone,
            email,
            source: channel,
          });
          return { ok: true, leadId };
        } catch {
          return {
            ok: false,
            erro: 'Não foi possível registrar o contato agora.',
          };
        }
      },
    }),

    bookAppointment: dynamicTool({
      description:
        'Registra um pedido de agendamento (a conversão). Use quando o paciente confirmar que quer marcar. Garanta antes nome e telefone. Informe o procedimento e a preferência de dia/horário em texto livre.',
      inputSchema: jsonSchema<BookInput>({
        type: 'object',
        properties: {
          nome: {
            type: 'string',
            description: 'Nome do paciente (se ainda não capturado).',
          },
          telefone: { type: 'string', description: 'Telefone do paciente.' },
          procedimento: {
            type: 'string',
            description: 'Procedimento desejado.',
          },
          preferencia: {
            type: 'string',
            description: 'Preferência de dia/horário em texto livre.',
          },
        },
        additionalProperties: false,
      }),
      execute: async (input) => {
        const { nome, telefone, procedimento, preferencia } =
          input as BookInput;
        try {
          const leadId = nome
            ? await upsertLead(prisma, {
                clinicId,
                conversationId,
                nome,
                telefone,
                source: channel,
              })
            : ((
                await prisma.conversation.findFirst({
                  where: { id: conversationId, clinicId },
                  select: { leadId: true },
                })
              )?.leadId ?? null);

          const procedure = procedimento
            ? (await findProcedures(procedimento, 1))[0]
            : undefined;

          const appointment = await prisma.appointment.create({
            data: {
              clinicId,
              conversationId,
              leadId,
              procedureId: procedure?.id ?? null,
              preferredTime: preferencia ?? null,
            },
            select: { id: true },
          });

          // Conversão: em_andamento → agendada (no-op se já agendada).
          try {
            await conversations.markAsScheduled(conversationId, clinicId);
          } catch {
            /* status já final / transição não permitida — não bloqueia o agendamento */
          }

          return { ok: true, appointmentId: appointment.id };
        } catch {
          return {
            ok: false,
            erro: 'Não foi possível registrar o agendamento agora.',
          };
        }
      },
    }),
  };

  return tools as unknown as ToolSet;
}

/** Cria ou atualiza o lead da conversa (escopo por clínica) e o vincula. */
async function upsertLead(
  prisma: PrismaService,
  args: {
    clinicId: string;
    conversationId: string;
    nome: string;
    telefone?: string;
    email?: string;
    source?: Channel;
  },
): Promise<string> {
  const convo = await prisma.conversation.findFirst({
    where: { id: args.conversationId, clinicId: args.clinicId },
    select: { leadId: true },
  });

  if (convo?.leadId) {
    const updated = await prisma.lead.update({
      where: { id: convo.leadId },
      data: {
        name: args.nome,
        ...(args.telefone ? { phone: args.telefone } : {}),
        ...(args.email ? { email: args.email } : {}),
      },
      select: { id: true },
    });
    return updated.id;
  }

  const lead = await prisma.lead.create({
    data: {
      clinicId: args.clinicId,
      name: args.nome,
      phone: args.telefone ?? null,
      email: args.email ?? null,
      source: args.source ?? 'web',
    },
    select: { id: true },
  });
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { leadId: lead.id },
  });
  return lead.id;
}
