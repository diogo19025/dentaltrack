import { Logger } from '@nestjs/common';
import { type ToolSet, dynamicTool, jsonSchema } from 'ai';
import {
  type Channel,
  MEDIA_TYPES,
  type MediaAttachment,
  type MediaType,
  type ProfessionalDto,
} from '@dentaltrack/shared';
import { bookingKey } from '../agenda/appointment-keys';
import type { AgendaService } from '../agenda/agenda.service';
import {
  formatDatePtBr,
  formatLocalDateTime,
  formatTimePtBr,
  parseLocalDateTime,
} from '../common/time';
import type { ConversationsService } from '../conversations/conversations.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Tools do agente (BE-1.4) — function calling via Vercel AI SDK.
 * São construídas por requisição, capturando o contexto (empresa + conversa),
 * então cada execução já é escopada por `clinicId`. Channel-agnostic.
 *
 * Usamos `dynamicTool` + `jsonSchema` (em vez de `tool`/`zodSchema`) de propósito:
 * a ponte de tipos zod↔AI-SDK instancia tipos "excessively deep" (TS2589) e
 * estoura a memória do `tsc`. JSON Schema puro mantém o type-checker leve; a
 * validação da entrada continua sendo feita pelo SDK contra o schema.
 */
const logger = new Logger('ChatTools');

export interface ChatToolsContext {
  prisma: PrismaService;
  conversations: ConversationsService;
  clinicId: string;
  conversationId: string;
  /** Canal da conversa — vira o `source` do lead criado pelas tools. */
  channel?: Channel;
  /**
   * Coletor de mídia (F6): a tool `presentOffer` empurra aqui a mídia da oferta
   * escolhida (imagem/vídeo/áudio/catálogo). O adapter do canal (WhatsApp) envia
   * esses anexos após o texto; o web ignora (mantém texto). Mutável de propósito
   * — é preenchido durante a execução das tools no turno.
   */
  attachments?: MediaAttachment[];
  /**
   * Agenda da empresa (F9). Quando presente e conectada a um sistema de gestão,
   * o agente passa a oferecer **horários que existem de verdade** e a gravar o
   * agendamento na agenda real. Ausente, as tools caem no comportamento
   * anterior (preferência em texto livre) — o motor não quebra sem integração.
   */
  agenda?: AgendaService;
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
  /** Horário acordado, "AAAA-MM-DDTHH:mm" no fuso da empresa (F9). */
  dataHora?: string;
  /** Id do profissional do horário escolhido, como veio de checkAvailability (F20). */
  profissionalId?: string;
  /** Nome do profissional que o cliente pediu, quando não veio de um horário. */
  profissional?: string;
}
interface CheckAvailabilityInput {
  procedimento?: string;
  aPartirDe?: string;
  dias?: number;
  /** O que o cliente escreveu sobre com quem quer marcar (F20). */
  profissional?: string;
}
interface PresentOfferInput {
  procedimento?: string;
  interesse?: string;
}
interface CancelInput {
  agendamentoId: string;
  motivo?: string;
}
interface FindMyAppointmentsInput {
  motivo?: string;
}

/**
 * Estados em que um agendamento ainda está de pé — os únicos que fazem sentido
 * listar para quem quer desmarcar. `pedido` entra porque é um agendamento real
 * do ponto de vista do cliente (ele pediu e espera), mesmo sem horário
 * reservado na agenda da empresa.
 */
const OPEN_STATUSES = ['pedido', 'agendado', 'confirmado'] as const;

/**
 * Tolerância para trás ao listar agendamentos.
 *
 * Quem escreve "não vou conseguir chegar" às vezes escreve **depois** da hora
 * marcada — no caminho, atrasado, já passou. Cortar exatamente no instante
 * atual faria o agente responder "não encontrei nada no seu nome" para a
 * consulta que começou quinze minutos atrás, que é justamente a que ele quer
 * desmarcar.
 */
const RECENT_TOLERANCE_MS = 3 * 60 * 60 * 1000;

/**
 * Uma oferta escolhida por `presentOffer`: o texto (que o modelo tece na
 * resposta) e a mídia opcional (que vira anexo do turno para o canal enviar).
 */
interface SelectedOffer {
  text: string;
  media: MediaAttachment | null;
}

/** Normaliza (url, tipo) do banco num anexo; url vazia/ausente → sem mídia. */
function toAttachment(
  url: string | null | undefined,
  type: string | null | undefined,
  caption?: string,
): MediaAttachment | null {
  const u = url?.trim();
  if (!u) return null;
  const t = (MEDIA_TYPES as readonly string[]).includes(type ?? '')
    ? (type as MediaType)
    : 'image';
  const cap = caption?.trim();
  return { url: u, type: t, ...(cap ? { caption: cap } : {}) };
}

/** Linha mínima de oferta (procedimento ou settings) → SelectedOffer, ou null. */
function offerFromRow(
  row: {
    name?: string;
    offerText: string | null;
    offerMediaUrl: string | null;
    offerMediaType: string | null;
  },
  fallbackText: string,
): SelectedOffer | null {
  const text = row.offerText?.trim();
  const media = toAttachment(row.offerMediaUrl, row.offerMediaType);
  if (!text && !media) return null;
  return { text: text || fallbackText, media };
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

/** Campos de oferta lidos de um procedimento. */
const OFFER_SELECT = {
  name: true,
  offerText: true,
  offerMediaUrl: true,
  offerMediaType: true,
} as const;

/** Constrói o conjunto de tools para uma conversa específica. */
export function buildChatTools(ctx: ChatToolsContext): ToolSet {
  const { prisma, conversations, clinicId, conversationId, agenda } = ctx;
  const channel: Channel = ctx.channel ?? 'web';

  /**
   * Agendamentos em aberto **deste contato**, e de mais ninguém.
   *
   * O escopo é a conversa: o lead vinculado a ela, ou a própria conversa quando
   * o agendamento nasceu aqui antes de o lead existir. Nunca por telefone
   * solto — dois contatos podem compartilhar um número (o celular da família é
   * comum), e casar por ele deixaria o agente desmarcar a consulta do outro.
   */
  async function openAppointments() {
    const convo = await prisma.conversation.findFirst({
      where: { id: conversationId, clinicId },
      select: { leadId: true },
    });

    const owner = convo?.leadId
      ? [{ leadId: convo.leadId }, { conversationId }]
      : [{ conversationId }];

    return prisma.appointment.findMany({
      where: {
        clinicId,
        status: { in: [...OPEN_STATUSES] },
        OR: owner,
        // Sem horário (só preferência em texto) também conta: é um pedido de
        // pé que o cliente pode querer desfazer.
        AND: [
          {
            OR: [
              { startsAt: null },
              { startsAt: { gte: new Date(Date.now() - RECENT_TOLERANCE_MS) } },
            ],
          },
        ],
      },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
      take: 5,
      select: {
        id: true,
        status: true,
        startsAt: true,
        preferredTime: true,
        procedure: { select: { name: true } },
      },
    });
  }

  /**
   * O id que o modelo mandou é mesmo de um agendamento deste contato?
   *
   * **Esta é a checagem que importa.** O `agendamentoId` chega como texto
   * gerado por um modelo a partir de uma conversa que o cliente escreve — ou
   * seja, é entrada não confiável por definição. Sem revalidar contra o dono,
   * uma mensagem bem construída poderia cancelar a consulta de outra pessoa.
   * Confirmar na lista do próprio contato custa uma consulta e fecha isso.
   */
  async function requireOwnAppointment(id: string) {
    const trimmed = (id ?? '').trim();
    if (!trimmed) return null;
    const mine = await openAppointments();
    return mine.find((row) => row.id === trimmed) ?? null;
  }

  /** "quinta-feira, 18/09/2026 às 17:00" — ou a preferência em texto livre. */
  async function whenLabel(row: {
    startsAt: Date | null;
    preferredTime: string | null;
  }): Promise<string> {
    if (!row.startsAt)
      return row.preferredTime?.trim() || 'horário a confirmar';
    const timeZone = agenda
      ? await agenda.timeZone(clinicId)
      : 'America/Sao_Paulo';
    return `${formatDatePtBr(row.startsAt, timeZone)} às ${formatTimePtBr(row.startsAt, timeZone)}`;
  }

  /**
   * Procedimento do catálogo pelo nome, com a duração — que é o que define o
   * tamanho do horário a reservar na agenda. Diferente de `findProcedures`,
   * que devolve a visão formatada para o modelo ler.
   */
  async function findProcedureRow(query: string): Promise<{
    id: string;
    name: string;
    durationMinutes: number | null;
  } | null> {
    const q = query.trim();
    if (!q) return null;
    return prisma.procedure.findFirst({
      where: {
        clinicId,
        active: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, durationMinutes: true },
    });
  }

  /**
   * Escolhe a oferta mais pertinente (F6) para o momento da conversa:
   *  1. procedimento nomeado com oferta própria (mais específico);
   *  2. interesse → tags casadas → procedimento com oferta (personalização por tag);
   *  3. oferta global da empresa (se ativa), como fallback.
   * Retorna o texto + mídia opcional; `null` se não houver nada a oferecer.
   */
  async function selectOffer(
    procedimento?: string,
    interesse?: string,
  ): Promise<SelectedOffer | null> {
    // 1. Procedimento específico.
    const term = procedimento?.trim();
    if (term) {
      const proc = await prisma.procedure.findFirst({
        where: {
          clinicId,
          active: true,
          name: { contains: term, mode: 'insensitive' },
        },
        select: OFFER_SELECT,
      });
      if (proc) {
        const offer = offerFromRow(
          proc,
          `Temos uma condição especial para ${proc.name}.`,
        );
        if (offer) return offer;
      }
    }

    // 2. Interesse → tags → procedimento com oferta (personalização por tag).
    const q = interesse?.trim();
    if (q) {
      const text = q.toLowerCase();
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
      if (matchedTagIds.length > 0) {
        const rows = await prisma.procedure.findMany({
          where: {
            clinicId,
            active: true,
            tags: { some: { id: { in: matchedTagIds } } },
          },
          orderBy: { name: 'asc' },
          select: OFFER_SELECT,
        });
        for (const proc of rows) {
          const offer = offerFromRow(
            proc,
            `Temos uma condição especial para ${proc.name}.`,
          );
          if (offer) return offer;
        }
      }
    }

    // 3. Oferta global da empresa (fallback).
    const settings = await prisma.clinicSettings.findUnique({
      where: { clinicId },
      select: {
        offerEnabled: true,
        offerText: true,
        offerMediaUrl: true,
        offerMediaType: true,
      },
    });
    if (settings?.offerEnabled) {
      return offerFromRow(settings, 'Temos uma oferta especial em vigor.');
    }
    return null;
  }

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
   * TAGS de interesse casam com o relato do cliente (nome da tag ou alguma
   * keyword aparece no texto). As tags são poucas por empresa, então buscá-las
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
        "Busca procedimentos no catálogo da empresa por um termo (ex.: 'implante', 'clareamento'). Use para responder sobre descrição, preço e duração. Não invente procedimentos fora do catálogo.",
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
        "Sugere procedimentos do catálogo com base no interesse/sintoma relatado pelo cliente (ex.: 'dente amarelo', 'dor'). Retorna opções pertinentes para recomendar.",
      inputSchema: jsonSchema<SuggestInput>({
        type: 'object',
        properties: {
          interesse: {
            type: 'string',
            description: 'O que o cliente quer/relata.',
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

    presentOffer: dynamicTool({
      description:
        'Apresenta a oferta/promoção mais pertinente ao cliente (F6). Chame quando ele demonstrar interesse num procedimento ou tema. Informe `procedimento` (nome do procedimento de interesse) e/ou `interesse` (o que o cliente relata). Retorna o texto da oferta para você adaptar na resposta; se houver mídia (imagem/vídeo/áudio/catálogo), ela é enviada automaticamente pelo canal — mencione que está enviando o material, sem inventar links.',
      inputSchema: jsonSchema<PresentOfferInput>({
        type: 'object',
        properties: {
          procedimento: {
            type: 'string',
            description: 'Procedimento de interesse (se identificado).',
          },
          interesse: {
            type: 'string',
            description: 'O que o cliente relata/procura.',
          },
        },
        additionalProperties: false,
      }),
      execute: async (input) => {
        const { procedimento, interesse } = input as PresentOfferInput;
        const offer = await selectOffer(procedimento, interesse);
        if (!offer) {
          return {
            ok: false,
            motivo: 'Nenhuma oferta disponível para este caso no momento.',
          };
        }
        if (offer.media) ctx.attachments?.push(offer.media);
        return {
          ok: true,
          oferta: offer.text,
          enviandoMidia: Boolean(offer.media),
          tipoMidia: offer.media?.type,
        };
      },
    }),

    captureLead: dynamicTool({
      description:
        'Registra (ou atualiza) os dados de contato do cliente quando ele demonstrar interesse. Chame assim que tiver o nome e, de preferência, o telefone.',
      inputSchema: jsonSchema<CaptureLeadInput>({
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome do cliente.' },
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

    checkAvailability: dynamicTool({
      description:
        'Consulta os horários REALMENTE livres na agenda da empresa. Use SEMPRE antes de sugerir qualquer dia ou horário ao cliente. Se a resposta vier com agendaConectada=false, NÃO invente horários: pergunte a preferência de dia/período do cliente e diga que a equipe confirma a disponibilidade.',
      inputSchema: jsonSchema<CheckAvailabilityInput>({
        type: 'object',
        properties: {
          procedimento: {
            type: 'string',
            description:
              'Procedimento desejado — ajusta a duração do horário reservado.',
          },
          aPartirDe: {
            type: 'string',
            description:
              'Data inicial da busca no formato AAAA-MM-DD. Vazio = a partir de hoje.',
          },
          dias: {
            type: 'number',
            description: 'Quantos dias buscar à frente (padrão 10, máximo 30).',
          },
          profissional: {
            type: 'string',
            description:
              'Profissional que o cliente pediu, exatamente como ele escreveu (ex.: "Dra. Ana"). Vazio = qualquer um.',
          },
        },
        additionalProperties: false,
      }),
      execute: async (input) => {
        const { procedimento, aPartirDe, dias, profissional } =
          input as CheckAvailabilityInput;
        if (!agenda) {
          return {
            agendaConectada: false,
            orientacao:
              'A agenda não está conectada. Pergunte a preferência de dia e período e explique que a equipe confirma o horário.',
          };
        }

        try {
          const [timeZone, procedure] = await Promise.all([
            agenda.timeZone(clinicId),
            procedimento ? findProcedureRow(procedimento) : null,
          ]);
          const from = aPartirDe
            ? (parseLocalDateTime(`${aPartirDe}T00:00`, timeZone) ?? new Date())
            : new Date();

          // Quem o cliente pediu (F20). Ambíguo ou desconhecido não vira
          // chute: a ferramenta devolve as opções e o modelo pergunta.
          let professionalId: string | null = null;
          if (profissional?.trim()) {
            const match = await agenda.resolveProfessional(
              clinicId,
              profissional,
            );
            if (match.kind === 'ambiguo') {
              return {
                agendaConectada: true,
                horarios: [],
                profissionalAmbiguo: match.options.map((p) => p.name),
                orientacao:
                  'Mais de um profissional corresponde ao nome. Pergunte ao cliente qual deles e consulte de novo com o nome completo.',
              };
            }
            if (match.kind === 'nenhum') {
              return {
                agendaConectada: true,
                horarios: [],
                orientacao:
                  'Nenhum profissional da equipe tem esse nome. Diga isso ao cliente com gentileza, liste os profissionais que atendem e pergunte com quem ele prefere — ou consulte sem `profissional` para oferecer o primeiro horário livre.',
              };
            }
            if (!match.professional.externalId) {
              return {
                agendaConectada: true,
                horarios: [],
                orientacao:
                  'Esse profissional não está vinculado à agenda conectada. Explique que não é possível confirmar horários com ele e ofereça consultar os profissionais disponíveis.',
              };
            }
            professionalId = match.professional.externalId;
          }

          const { slots, live } = await agenda.getAvailability(clinicId, {
            from,
            days: Math.min(Math.max(dias ?? 10, 1), 30),
            durationMinutes: procedure?.durationMinutes ?? null,
            // 12 e não 6: com poucos horários o modelo lê a lista truncada como
            // "o resto está ocupado" e nega horários que existem.
            limit: 12,
            professionalId,
          });

          if (!live || slots.length === 0) {
            return {
              agendaConectada: live,
              horarios: [],
              orientacao: live
                ? 'A agenda respondeu, mas não há horários livres no período. Ofereça um período diferente.'
                : 'A agenda não está conectada. Pergunte a preferência de dia e período e explique que a equipe confirma o horário.',
            };
          }

          return {
            agendaConectada: true,
            horarios: slots.map((slot) => {
              const startsAt = new Date(slot.startsAt);
              return {
                // O agente devolve este valor em `dataHora` ao agendar. Hora de
                // parede da empresa — o mesmo "13:00" do rótulo, nunca UTC.
                dataHora: formatLocalDateTime(startsAt, timeZone),
                rotulo: `${formatDatePtBr(startsAt, timeZone)} às ${formatTimePtBr(startsAt, timeZone)}`,
                profissional: slot.professionalName,
                // Volta em `profissionalId` no bookAppointment: é assim que o
                // horário oferecido e o agendamento gravado ficam com a mesma
                // pessoa quando a empresa tem vários profissionais.
                profissionalId: slot.professionalId,
              };
            }),
            orientacao:
              'Ofereça no máximo 3 destes horários por vez e use os campos dataHora e profissionalId exatamente como vieram ao registrar o agendamento. Esta lista pode ser parcial: se o cliente pedir um dia ou horário que não aparece nela, consulte de novo com aPartirDe no dia pedido antes de dizer que não há vaga.',
          };
        } catch {
          return {
            agendaConectada: false,
            horarios: [],
            orientacao:
              'Não foi possível consultar a agenda agora. Pergunte a preferência do cliente e diga que a equipe confirma.',
          };
        }
      },
    }),

    bookAppointment: dynamicTool({
      description:
        'Registra o agendamento (a conversão). Use quando o cliente confirmar que quer marcar. Garanta antes nome e telefone. Se você consultou a agenda e o cliente escolheu um horário, informe `dataHora` com o valor exato devolvido pela consulta; caso contrário, descreva a preferência em texto livre.',
      inputSchema: jsonSchema<BookInput>({
        type: 'object',
        properties: {
          nome: {
            type: 'string',
            description: 'Nome do cliente (se ainda não capturado).',
          },
          telefone: { type: 'string', description: 'Telefone do cliente.' },
          procedimento: {
            type: 'string',
            description: 'Procedimento desejado.',
          },
          preferencia: {
            type: 'string',
            description:
              'Preferência de dia/horário em texto livre (use quando não houver horário confirmado).',
          },
          dataHora: {
            type: 'string',
            description:
              'Horário escolhido, exatamente como veio de checkAvailability (AAAA-MM-DDTHH:mm).',
          },
          profissionalId: {
            type: 'string',
            description:
              'Profissional do horário escolhido, exatamente o profissionalId devolvido por checkAvailability.',
          },
          profissional: {
            type: 'string',
            description:
              'Nome do profissional pedido pelo cliente, quando não há profissionalId (ex.: sem agenda conectada).',
          },
        },
        additionalProperties: false,
      }),
      execute: async (input) => {
        const {
          nome,
          telefone,
          procedimento,
          preferencia,
          dataHora,
          profissionalId,
          profissional,
        } = input as BookInput;
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
            ? await findProcedureRow(procedimento)
            : null;

          const startsAt =
            dataHora && agenda
              ? parseLocalDateTime(dataHora, await agenda.timeZone(clinicId))
              : null;

          const lead = leadId
            ? await prisma.lead.findFirst({
                where: { id: leadId, clinicId },
                select: { name: true, phone: true },
              })
            : null;

          // Profissional (F20): o id do horário oferecido vale mais que o nome.
          // Se a escolha explícita deixou de existir, parar é mais seguro do
          // que reservar silenciosamente com outra pessoa.
          const professionalResolution = agenda
            ? await resolveProfessional(agenda, clinicId, {
                profissionalId,
                profissional,
              })
            : ({ ok: true, professional: null } as const);
          if (!professionalResolution.ok) {
            return {
              ok: false,
              erro: professionalResolution.error,
              orientacao:
                'Não afirme que está marcado. Consulte checkAvailability novamente ou peça ao cliente para escolher um profissional disponível.',
            };
          }
          const professional = professionalResolution.professional;

          // Com agenda conectada e horário definido, isto grava também na
          // agenda real da empresa; sem uma coisa ou outra, registra só aqui —
          // e `confirmed` diz qual dos dois aconteceu.
          const booked = agenda
            ? await agenda.book(clinicId, {
                conversationId,
                leadId,
                procedureId: procedure?.id ?? null,
                procedureName: procedure?.name ?? procedimento ?? null,
                durationMinutes: procedure?.durationMinutes ?? null,
                startsAt,
                preferredTime: preferencia ?? null,
                patientName: nome ?? lead?.name ?? null,
                patientPhone: telefone ?? lead?.phone ?? null,
                professional,
              })
            : await bookWithoutAgenda(prisma, {
                clinicId,
                conversationId,
                leadId,
                procedureId: procedure?.id ?? null,
                procedureName: procedure?.name ?? procedimento ?? null,
                preferredTime: preferencia ?? null,
                patientPhone: telefone ?? lead?.phone ?? null,
              });

          // Conversão: em_andamento → agendada (no-op se já agendada).
          try {
            await conversations.markAsScheduled(conversationId, clinicId);
          } catch {
            /* status já final / transição não permitida — não bloqueia o agendamento */
          }

          // Conflito (P0.5/P0.1): o horário sumiu entre a oferta e a escolha. É
          // a única falha em que a conduta muda — o cliente precisa escolher
          // outro horário agora, não esperar a equipe. As demais (credencial,
          // agenda fora do ar, timeout) são problema nosso, não dele: o agente
          // não deve explicá-las nem pedir que ele tente de novo.
          const conflito =
            'failureKind' in booked && booked.failureKind === 'conflito';

          return {
            ok: true,
            appointmentId: booked.appointmentId,
            confirmado: booked.confirmed,
            orientacao: booked.confirmed
              ? 'Horário reservado na agenda. Pode confirmar ao cliente com dia e hora.'
              : conflito
                ? 'Esse horário acabou de ser ocupado por outra pessoa. Peça desculpas, consulte checkAvailability de novo e ofereça outros horários — não afirme que está marcado.'
                : 'O pedido ficou registrado, mas o horário NÃO foi reservado na agenda. Diga ao cliente que a equipe confirma em seguida — não afirme que está marcado.',
          };
        } catch {
          return {
            ok: false,
            erro: 'Não foi possível registrar o agendamento agora.',
          };
        }
      },
    }),

    findMyAppointments: dynamicTool({
      description:
        'Lista os agendamentos em aberto DESTE cliente. Chame SEMPRE antes de falar em desmarcar, cancelar, remarcar ou "não vou poder ir" — é a única forma de saber qual agendamento ele tem e obter o `agendamentoId` que `cancelAppointment` exige. Nunca invente esse id.',
      // O parâmetro é opcional para o modelo, mas o objeto de parâmetros NÃO
      // pode ser vazio: o Gemini — que é justamente o provider de fallback —
      // recusa a declaração de função com `properties: {}` (400
      // INVALID_ARGUMENT). Como o fallback só roda depois de o primário já ter
      // caído, e a falha chega ao usuário como o mesmo 503 amigável de sempre,
      // uma tool sem parâmetros derrubaria o plano B sem sintoma próprio.
      inputSchema: jsonSchema<FindMyAppointmentsInput>({
        type: 'object',
        properties: {
          motivo: {
            type: 'string',
            description:
              'O que o cliente disse, em poucas palavras (opcional) — o mesmo campo de cancelAppointment.',
          },
        },
        required: [],
        additionalProperties: false,
      }),
      execute: async (input) => {
        const { motivo } = (input ?? {}) as FindMyAppointmentsInput;
        try {
          const rows = await openAppointments();
          // O texto do cliente não vai para o log em hipótese alguma (regra do
          // `common/redact.ts`); só o fato de ele ter vindo, que é o que diz se
          // o modelo está seguindo o fluxo de cancelamento.
          logger.log({
            event: 'agenda.find_my_appointments',
            encontrados: rows.length,
            motivoInformado: Boolean(motivo?.trim()),
          });
          if (rows.length === 0) {
            return {
              agendamentos: [],
              orientacao:
                'Nenhum agendamento em aberto no cadastro deste contato. Não afirme que cancelou nada. Peça o nome completo usado no agendamento e diga que a equipe verifica.',
            };
          }

          return {
            agendamentos: await Promise.all(
              rows.map(async (row) => ({
                agendamentoId: row.id,
                quando: await whenLabel(row),
                procedimento: row.procedure?.name ?? null,
                situacao: row.status,
              })),
            ),
            orientacao:
              'Se houver mais de um, pergunte qual antes de cancelar. Use o `agendamentoId` exatamente como veio.',
          };
        } catch {
          return {
            agendamentos: [],
            orientacao:
              'Não foi possível consultar os agendamentos agora. Diga que a equipe verifica e retorna — não afirme que cancelou.',
          };
        }
      },
    }),

    cancelAppointment: dynamicTool({
      description:
        'Cancela DE VERDADE um agendamento deste cliente, na agenda da empresa. Use quando ele disser que não poderá comparecer, que quer desmarcar ou cancelar. Exige o `agendamentoId` vindo de `findMyAppointments` — chame-a primeiro. NUNCA diga ao cliente que cancelou antes desta ferramenta retornar ok:true.',
      inputSchema: jsonSchema<CancelInput>({
        type: 'object',
        properties: {
          agendamentoId: {
            type: 'string',
            description:
              'Id do agendamento, exatamente como veio de findMyAppointments.',
          },
          motivo: {
            type: 'string',
            description: 'O que o cliente disse (opcional, para o registro).',
          },
        },
        required: ['agendamentoId'],
        additionalProperties: false,
      }),
      execute: async (input) => {
        const { agendamentoId } = input as CancelInput;
        try {
          const row = await requireOwnAppointment(agendamentoId);
          if (!row) {
            // Inclui o caso do id inventado pelo modelo e o do agendamento de
            // outra pessoa — os dois recebem a mesma resposta, que não confirma
            // nem nega a existência de nada fora deste contato.
            return {
              ok: false,
              motivo: 'nao_encontrado',
              orientacao:
                'Este agendamento não está na lista deste contato. Chame findMyAppointments e confirme com o cliente qual é. Não diga que cancelou.',
            };
          }

          const quando = await whenLabel(row);

          if (agenda) {
            await agenda.cancel(clinicId, row.id);
          } else {
            await cancelWithoutAgenda(prisma, clinicId, row.id);
          }

          return {
            ok: true,
            agendamentoId: row.id,
            quando,
            orientacao: `Cancelado de verdade na agenda da empresa (${quando}). Confirme ao cliente, com empatia e sem cobrança, e ofereça remarcar — se ele quiser, consulte checkAvailability e registre com bookAppointment.`,
          };
        } catch {
          // Erro do provedor (credencial, indisponibilidade, timeout): o
          // horário continua ocupado na agenda da empresa. Prometer o
          // cancelamento aqui é exatamente o defeito que esta tool corrige.
          return {
            ok: false,
            motivo: 'agenda_indisponivel',
            orientacao:
              'NÃO foi possível cancelar agora — o horário continua marcado. Diga ao cliente que a equipe confirma o cancelamento em seguida. Não afirme que está cancelado.',
          };
        }
      },
    }),
  };

  return tools as unknown as ToolSet;
}

/**
 * Registra o pedido de agendamento quando a conversa **não** tem agenda ligada
 * — sem horário e sem escrita externa, só o interesse do cliente.
 *
 * Carrega a mesma `bookingKey` do `AgendaService.book()` de propósito: este é o
 * segundo (e único outro) ponto do sistema que cria um `Appointment`, e deixá-lo
 * sem chave reabriria pelo outro lado o buraco que a P0.5 fechou. Hoje o
 * caminho não é alcançável em produção — o `ChatService` sempre injeta a agenda
 * —, mas "inalcançável" é propriedade que se perde no primeiro chamador novo.
 */
/**
 * Profissional do agendamento (F20), na ordem em que a informação é confiável:
 * o id que veio num horário oferecido, depois o nome que o cliente escreveu.
 * Sem escolha explícita devolve `null` e deixa valer a política da empresa.
 * Escolha ambígua, desconhecida ou indisponível falha fechada: nunca troca a
 * pessoa escolhida pelo padrão da integração sem avisar.
 */
type ProfessionalResolution =
  | { ok: true; professional: ProfessionalDto | null }
  | { ok: false; error: string };

async function resolveProfessional(
  agenda: AgendaService,
  clinicId: string,
  input: { profissionalId?: string; profissional?: string },
): Promise<ProfessionalResolution> {
  try {
    if (input.profissionalId?.trim()) {
      const byId = await agenda.professionalByExternalId(
        clinicId,
        input.profissionalId.trim(),
      );
      return byId
        ? { ok: true, professional: byId }
        : {
            ok: false,
            error:
              'O profissional do horário escolhido não está mais disponível.',
          };
    }
    if (input.profissional?.trim()) {
      const match = await agenda.resolveProfessional(
        clinicId,
        input.profissional,
      );
      if (match.kind === 'um') {
        return { ok: true, professional: match.professional };
      }
      return {
        ok: false,
        error:
          match.kind === 'ambiguo'
            ? 'Mais de um profissional corresponde ao nome informado.'
            : 'O profissional informado não está disponível na agenda.',
      };
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Profissional não resolvido para a empresa ${clinicId}: ${detail}`,
    );
    return {
      ok: false,
      error: 'Não foi possível confirmar o profissional escolhido agora.',
    };
  }
  return { ok: true, professional: null };
}

async function bookWithoutAgenda(
  prisma: PrismaService,
  args: {
    clinicId: string;
    conversationId: string;
    leadId: string | null;
    procedureId: string | null;
    procedureName: string | null;
    preferredTime: string | null;
    patientPhone: string | null;
  },
): Promise<{
  appointmentId: string;
  confirmed: boolean;
  startsAt: Date | null;
}> {
  const key = bookingKey({
    conversationId: args.conversationId,
    leadId: args.leadId,
    patientPhone: args.patientPhone,
    startsAt: null,
    procedureId: args.procedureId,
    procedureName: args.procedureName,
  });
  const data = {
    clinicId: args.clinicId,
    conversationId: args.conversationId,
    leadId: args.leadId,
    procedureId: args.procedureId,
    preferredTime: args.preferredTime,
    bookingKey: key,
  };

  try {
    const created = await prisma.appointment.create({
      data,
      select: { id: true },
    });
    return { appointmentId: created.id, confirmed: false, startsAt: null };
  } catch (err) {
    const collided =
      key !== null &&
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === 'P2002';
    if (!collided) throw err;

    const existing = await prisma.appointment.findFirst({
      where: { clinicId: args.clinicId, bookingKey: key },
      select: { id: true },
    });
    if (!existing) throw err;
    return { appointmentId: existing.id, confirmed: false, startsAt: null };
  }
}

/**
 * Cancela quando a conversa **não** tem agenda ligada — só o registro local.
 *
 * Espelha o `bookWithoutAgenda` e existe pelo mesmo motivo: hoje o `ChatService`
 * sempre injeta a agenda, mas "inalcançável" é propriedade que se perde no
 * primeiro chamador novo, e o modo de falha aqui seria o agente dizer que
 * cancelou sem ter cancelado — o defeito que estas tools existem para fechar.
 *
 * Sem `externalId` para desfazer: a linha local é tudo o que há. Os lembretes
 * pendentes morrem sozinhos, porque a revalidação da fila suprime o que aponta
 * para agendamento `cancelado`.
 */
async function cancelWithoutAgenda(
  prisma: PrismaService,
  clinicId: string,
  id: string,
): Promise<void> {
  await prisma.appointment.updateMany({
    where: { id, clinicId, status: { not: 'cancelado' } },
    data: { status: 'cancelado', canceledAt: new Date() },
  });
}

/** Cria ou atualiza o lead da conversa (escopo por empresa) e o vincula. */
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
