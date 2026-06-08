import { Injectable } from "@nestjs/common";
import type { LeadDto, LeadsResponse, LeadTag } from "@dentaltrack/shared";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Leads capturados pelas conversas (F3 · GET /leads). Escopado por `clinicId`.
 * Para cada lead, deriva: interesse (procedimento do último agendamento, senão
 * 1ª tag), tags distintas e status (da conversa mais recente). Ver context §10.
 */
@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(clinicId: string): Promise<LeadsResponse> {
    const leads = await this.prisma.lead.findMany({
      where: { clinicId },
      orderBy: { createdAt: "desc" },
      include: {
        conversations: {
          orderBy: { createdAt: "desc" },
          select: {
            status: true,
            conversationTags: {
              orderBy: { confidence: "desc" },
              select: { tag: { select: { name: true, color: true } } },
            },
          },
        },
        appointments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { procedure: { select: { name: true } } },
        },
      },
    });

    const summary = { total: leads.length, agendada: 0, andamento: 0, abandonada: 0 };

    const dtos: LeadDto[] = leads.map((lead) => {
      const status = lead.conversations[0]?.status ?? null;
      if (status === "agendada") summary.agendada += 1;
      else if (status === "em_andamento") summary.andamento += 1;
      else if (status === "abandonada") summary.abandonada += 1;

      // Tags distintas de todas as conversas do lead (ordem por confiança).
      const seen = new Set<string>();
      const tags: LeadTag[] = [];
      for (const convo of lead.conversations) {
        for (const ct of convo.conversationTags) {
          const key = ct.tag.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          tags.push({ name: ct.tag.name, color: ct.tag.color });
        }
      }

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
      };
    });

    return { leads: dtos, summary };
  }
}
