import { Injectable } from '@nestjs/common';
import type { LeadDto, LeadsResponse, LeadTag } from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scoreLead, type LeadScoreSignals } from './lead-scoring';

/**
 * Leads capturados pelas conversas (F3 · GET /leads). Escopado por `clinicId`.
 * Para cada lead, deriva: interesse (procedimento do último agendamento, senão
 * 1ª tag), tags distintas, status (da conversa mais recente) e score/temperatura
 * de conversão (`lead-scoring.ts`, calculado on-read). Ver context §10.
 */
@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
