import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppointmentStatus, StatusMapping } from '@dentaltrack/shared';
import type { ExternalAppointment } from '../clinicorp/agenda-provider';
import { IntegrationService } from '../clinicorp/integration.service';
import { suggestStatus } from '../clinicorp/status-heuristics';
import type { Env } from '../config/env.validation';
import { OptOutService } from '../automations/opt-out.service';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_PAST_DAYS = 3;
const DEFAULT_FUTURE_DAYS = 21;

export interface SyncSummary {
  criados: number;
  atualizados: number;
  ignorados: number;
}

/**
 * Sincronização da agenda (F9) — traz o que está no sistema de gestão para cá.
 *
 * **Por polling, e não por webhook**, porque o inventário público da API não
 * expõe notificação de mudança de status. Isso tem uma consequência de produto
 * que vale nomear: a detecção de falta e de atraso é tão fresca quanto o
 * intervalo desta rodada. Com 10 minutos, o aviso de atraso de 15 sai entre 15
 * e 25 minutos depois do horário — aceitável. Se o fornecedor confirmar que há
 * webhook, é aqui que ele entra, e o resto do sistema não muda.
 *
 * A janela cobre alguns dias para trás (para capturar faltas e atendimentos
 * concluídos) e algumas semanas para frente (para alimentar os lembretes).
 */
@Injectable()
export class AgendaSyncService {
  private readonly logger = new Logger(AgendaSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Sincroniza todas as empresas com integração ligada. */
  async syncAll(): Promise<SyncSummary> {
    const total: SyncSummary = { criados: 0, atualizados: 0, ignorados: 0 };
    const clinics = await this.prisma.clinicIntegration.findMany({
      where: { mode: { not: 'desligado' } },
      select: { clinicId: true },
    });

    for (const { clinicId } of clinics) {
      try {
        const summary = await this.syncClinic(clinicId);
        total.criados += summary.criados;
        total.atualizados += summary.atualizados;
        total.ignorados += summary.ignorados;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Falha ao sincronizar a agenda da empresa ${clinicId}: ${detail}`,
        );
        await this.integrations.recordSync(clinicId, detail.slice(0, 500));
      }
    }
    return total;
  }

  async syncClinic(clinicId: string, now = new Date()): Promise<SyncSummary> {
    const summary: SyncSummary = { criados: 0, atualizados: 0, ignorados: 0 };
    const provider = await this.integrations.getProvider(clinicId);
    if (!provider) return summary;

    const from = new Date(now.getTime() - this.pastDays() * 24 * 3_600_000);
    const to = new Date(now.getTime() + this.futureDays() * 24 * 3_600_000);
    const appointments = await provider.listAppointments({ from, to });
    const mappings = await this.integrations.statusMappingsOf(clinicId);

    for (const external of appointments) {
      try {
        const outcome = await this.upsert(clinicId, external, mappings);
        summary[outcome] += 1;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Agendamento externo ${external.externalId} não pôde ser sincronizado: ${detail}`,
        );
        summary.ignorados += 1;
      }
    }

    await this.integrations.recordSync(clinicId, null);
    this.logger.log(
      `Agenda da empresa ${clinicId}: ${summary.criados} novo(s), ${summary.atualizados} atualizado(s).`,
    );
    return summary;
  }

  private async upsert(
    clinicId: string,
    external: ExternalAppointment,
    mappings: StatusMapping[],
  ): Promise<'criados' | 'atualizados' | 'ignorados'> {
    const existing = await this.prisma.appointment.findUnique({
      where: {
        clinicId_externalId: { clinicId, externalId: external.externalId },
      },
      select: { id: true, status: true, leadId: true, conversationId: true },
    });

    const status = this.resolveStatus(mappings, external, existing?.status);
    const leadId =
      existing?.leadId ?? (await this.resolveLead(clinicId, external));
    const conversationId =
      existing?.conversationId ??
      (leadId ? await this.latestConversation(clinicId, leadId) : null);

    const data = {
      startsAt: external.startsAt,
      endsAt: external.endsAt,
      status,
      source: 'integracao' as const,
      professionalExternalId: external.professionalExternalId,
      professionalName: external.professionalName,
      unitExternalId: external.unitExternalId,
      notes: external.procedureName,
      lastSyncedAt: new Date(),
      leadId,
      conversationId,
    };

    if (existing) {
      await this.prisma.appointment.update({
        where: { id: existing.id },
        data,
      });
      return 'atualizados';
    }

    await this.prisma.appointment.create({
      data: { clinicId, externalId: external.externalId, ...data },
    });
    return 'criados';
  }

  /**
   * Status do agendamento, em ordem de autoridade:
   * 1. o mapeamento que o operador confirmou;
   * 2. a sugestão por nome (para a conta que ainda não mapeou nada);
   * 3. o que já estava aqui — porque um status irreconhecível **não pode**
   *    reclassificar um agendamento por conta própria;
   * 4. `agendado`, só para um registro novo sem qualquer pista.
   */
  private resolveStatus(
    mappings: StatusMapping[],
    external: ExternalAppointment,
    current: AppointmentStatus | undefined,
  ): AppointmentStatus {
    const mapped = this.integrations.translateStatus(
      mappings,
      external.statusExternalId,
      external.statusName,
    );
    if (mapped) return mapped;

    const suggested = external.statusName
      ? suggestStatus(external.statusName)
      : null;
    if (suggested) return suggested;

    return current ?? 'agendado';
  }

  /**
   * Acha (ou cria) o contato do paciente. A ordem — id externo, depois telefone
   * — evita o duplicado clássico: o mesmo paciente que já falou com o bot pelo
   * WhatsApp e agora aparece na agenda importada.
   */
  private async resolveLead(
    clinicId: string,
    external: ExternalAppointment,
  ): Promise<string | null> {
    if (external.patientExternalId) {
      const byExternal = await this.prisma.lead.findUnique({
        where: {
          clinicId_externalId: {
            clinicId,
            externalId: external.patientExternalId,
          },
        },
        select: { id: true },
      });
      if (byExternal) return byExternal.id;
    }

    const phone = OptOutService.normalizePhone(external.patientPhone);
    if (phone) {
      const byPhone = await this.prisma.lead.findFirst({
        where: { clinicId, phone },
        orderBy: { createdAt: 'desc' },
        select: { id: true, externalId: true },
      });
      if (byPhone) {
        if (!byPhone.externalId && external.patientExternalId) {
          await this.prisma.lead
            .update({
              where: { id: byPhone.id },
              data: { externalId: external.patientExternalId },
            })
            .catch(() => undefined);
        }
        return byPhone.id;
      }
    }

    // Sem telefone e sem id não há como identificar ninguém com segurança:
    // criar um contato "Maria" solto geraria duplicata a cada sincronia.
    if (!phone && !external.patientExternalId) return null;

    const created = await this.prisma.lead.create({
      data: {
        clinicId,
        name: external.patientName,
        phone,
        externalId: external.patientExternalId,
        source: 'clinicorp',
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Conversa mais recente do contato — é nela que a resposta vai cair. */
  private async latestConversation(
    clinicId: string,
    leadId: string,
  ): Promise<string | null> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { clinicId, leadId },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });
    return conversation?.id ?? null;
  }

  private pastDays(): number {
    return (
      this.config.get('AGENDA_SYNC_PAST_DAYS', { infer: true }) ??
      DEFAULT_PAST_DAYS
    );
  }

  private futureDays(): number {
    return (
      this.config.get('AGENDA_SYNC_FUTURE_DAYS', { infer: true }) ??
      DEFAULT_FUTURE_DAYS
    );
  }
}
