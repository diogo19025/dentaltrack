import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  LeadDetail,
  LeadDto,
  LeadsResponse,
  LeadTag,
} from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scoreLead, type LeadScoreSignals } from './lead-scoring';

/**
 * Leads capturados pelas conversas (F3 · GET /leads). Escopado por `clinicId`.
 * Para cada lead, deriva: interesse (procedimento do último agendamento, senão
 * 1ª tag), tags distintas, status (da conversa mais recente) e score/temperatura
 * de conversão (`lead-scoring.ts`, calculado on-read). Ver context §10.
 * `detail()` (GET /leads/:id) expande conversas e agendamentos — as conversas
 * levam `id` + `channel`, referência p/ abrir direto no canal (WhatsApp, pós-MVP).
 */
@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nome da clínica (cabeçalho do PDF exportado — F8). */
  async clinicName(clinicId: string): Promise<string | undefined> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true },
    });
    return clinic?.name ?? undefined;
  }

  async list(clinicId: string): Promise<LeadsResponse> {
    const leads = await this.prisma.lead.findMany({
      where: { clinicId },
      orderBy: { createdAt: 'desc' },
      include: {
        conversations: {
          orderBy: { createdAt: 'desc' },
          select: {
            status: true,
            lastMessageAt: true,
            conversationTags: {
              orderBy: { confidence: 'desc' },
              select: {
                confidence: true,
                tag: { select: { name: true, color: true } },
              },
            },
            _count: {
              select: { messages: { where: { role: 'user' } } },
            },
          },
        },
        appointments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { procedure: { select: { name: true } } },
        },
      },
    });

    const summary = {
      total: leads.length,
      agendada: 0,
      andamento: 0,
      abandonada: 0,
    };
    const temperatures = { quente: 0, medio: 0, fraco: 0 };
    const now = new Date(); // único por request → scores consistentes entre leads

    const dtos: LeadDto[] = leads.map((lead) => {
      const status = lead.conversations[0]?.status ?? null;
      if (status === 'agendada') summary.agendada += 1;
      else if (status === 'em_andamento') summary.andamento += 1;
      else if (status === 'abandonada') summary.abandonada += 1;

      // Tags distintas de todas as conversas do lead (ordem por confiança),
      // guardando a maior confiança de cada uma para o score.
      const maxConfidenceByTag = new Map<string, number>();
      const tags: LeadTag[] = [];
      let patientMessages = 0;
      let lastActivityAt: Date | null = null;
      for (const convo of lead.conversations) {
        patientMessages += convo._count.messages;
        if (
          convo.lastMessageAt &&
          (!lastActivityAt || convo.lastMessageAt > lastActivityAt)
        ) {
          lastActivityAt = convo.lastMessageAt;
        }
        for (const ct of convo.conversationTags) {
          const key = ct.tag.name.toLowerCase();
          const previous = maxConfidenceByTag.get(key);
          if (previous === undefined) {
            tags.push({ name: ct.tag.name, color: ct.tag.color });
            maxConfidenceByTag.set(key, ct.confidence);
          } else if (ct.confidence > previous) {
            maxConfidenceByTag.set(key, ct.confidence);
          }
        }
      }

      const signals: LeadScoreSignals = {
        hasAppointment:
          lead.appointments.length > 0 ||
          lead.conversations.some((c) => c.status === 'agendada'),
        patientMessages,
        tagConfidences: [...maxConfidenceByTag.values()],
        lastActivityAt,
        latestStatus: status,
      };
      const { score, temperature } = scoreLead(signals, now);
      temperatures[temperature] += 1;

      const procedure = lead.appointments[0]?.procedure?.name ?? null;
      const interest = procedure ?? tags[0]?.name ?? null;

      return {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        interest,
        tags,
        status,
        source: lead.source,
        createdAt: lead.createdAt.toISOString(),
        score,
        temperature,
      };
    });

    return { leads: dtos, summary, temperatures };
  }

  async detail(clinicId: string, leadId: string): Promise<LeadDetail> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, clinicId },
      include: {
        conversations: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            channel: true,
            status: true,
            lastMessageAt: true,
            createdAt: true,
            conversationTags: {
              orderBy: { confidence: 'desc' },
              select: {
                confidence: true,
                tag: { select: { name: true, color: true } },
              },
            },
            // Roles das mensagens: total p/ exibição + `user` p/ o score.
            messages: { select: { role: true } },
          },
        },
        appointments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            preferredTime: true,
            createdAt: true,
            procedure: { select: { name: true } },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    // Mesma agregação de sinais do list() → mesmo score nas duas rotas.
    const maxConfidenceByTag = new Map<string, number>();
    const tags: LeadTag[] = [];
    let patientMessages = 0;
    let lastActivityAt: Date | null = null;
    for (const convo of lead.conversations) {
      patientMessages += convo.messages.filter((m) => m.role === 'user').length;
      if (
        convo.lastMessageAt &&
        (!lastActivityAt || convo.lastMessageAt > lastActivityAt)
      ) {
        lastActivityAt = convo.lastMessageAt;
      }
      for (const ct of convo.conversationTags) {
        const key = ct.tag.name.toLowerCase();
        const previous = maxConfidenceByTag.get(key);
        if (previous === undefined) {
          tags.push({ name: ct.tag.name, color: ct.tag.color });
          maxConfidenceByTag.set(key, ct.confidence);
        } else if (ct.confidence > previous) {
          maxConfidenceByTag.set(key, ct.confidence);
        }
      }
    }

    const status = lead.conversations[0]?.status ?? null;
    const signals: LeadScoreSignals = {
      hasAppointment:
        lead.appointments.length > 0 ||
        lead.conversations.some((c) => c.status === 'agendada'),
      patientMessages,
      tagConfidences: [...maxConfidenceByTag.values()],
      lastActivityAt,
      latestStatus: status,
    };
    const { score, temperature } = scoreLead(signals);

    const procedure = lead.appointments[0]?.procedure?.name ?? null;

    return {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      interest: procedure ?? tags[0]?.name ?? null,
      tags,
      status,
      source: lead.source,
      createdAt: lead.createdAt.toISOString(),
      score,
      temperature,
      conversations: lead.conversations.map((convo) => ({
        id: convo.id,
        channel: convo.channel,
        status: convo.status,
        messageCount: convo.messages.length,
        lastMessageAt: convo.lastMessageAt?.toISOString() ?? null,
        createdAt: convo.createdAt.toISOString(),
        tags: convo.conversationTags.map((ct) => ({
          name: ct.tag.name,
          color: ct.tag.color,
        })),
      })),
      appointments: lead.appointments.map((appt) => ({
        id: appt.id,
        procedure: appt.procedure?.name ?? null,
        preferredTime: appt.preferredTime,
        createdAt: appt.createdAt.toISOString(),
      })),
    };
  }
}
