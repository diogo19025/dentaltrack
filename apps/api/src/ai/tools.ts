import { type ToolSet, dynamicTool, jsonSchema } from 'ai';
import {
  type Channel,
  MEDIA_TYPES,
  type MediaAttachment,
  type MediaType,
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
}
interface CheckAvailabilityInput {
  procedimento?: string;
  aPartirDe?: string;
  dias?: number;
}
interface PresentOfferInput {
  procedimento?: string;
  interesse?: string;
}

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
        },
        additionalProperties: false,
      }),
      execute: async (input) => {
        const { procedimento, aPartirDe, dias } =
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

          const { slots, live } = await agenda.getAvailability(clinicId, {
            from,
            days: Math.min(Math.max(dias ?? 10, 1), 30),
            durationMinutes: procedure?.durationMinutes ?? null,
            // 12 e não 6: com poucos horários o modelo lê a lista truncada como
            // "o resto está ocupado" e nega horários que existem.
            limit: 12,
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
              };
            }),
            orientacao:
              'Ofereça no máximo 3 destes horários por vez e use o campo dataHora exatamente como veio ao registrar o agendamento. Esta lista pode ser parcial: se o cliente pedir um dia ou horário que não aparece nela, consulte de novo com aPartirDe no dia pedido antes de dizer que não há vaga.',
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
        },
        additionalProperties: false,
      }),
      execute: async (input) => {
        const { nome, telefone, procedimento, preferencia, dataHora } =
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

          // Conflito (P0.5): o horário sumiu entre a oferta e a escolha. É
          // diferente de "a agenda falhou" — aqui o cliente precisa escolher
          // outro, não esperar a equipe.
          const conflito = 'conflict' in booked && booked.conflict === true;

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
