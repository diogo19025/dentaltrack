import { Injectable } from '@nestjs/common';
import type {
  OnboardingChecklistDto,
  OnboardingChecklistItem,
  OnboardingStep,
} from '@dentaltrack/shared';
import { IntegrationService } from '../clinicorp/integration.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Checklist de onboarding (P1.1) — derivado das tabelas existentes, no mesmo
 * espírito do `NotificationsService`: nenhuma tabela nova, nenhum flag por
 * item. Se a empresa desfaz um passo (apaga o catálogo, desconecta o número),
 * o item volta a pendente sozinho.
 */
@Injectable()
export class OnboardingChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationService,
  ) {}

  async getChecklist(clinicId: string): Promise<OnboardingChecklistDto> {
    const [settings, procedures, tags, agendaReady, automations] =
      await Promise.all([
        this.prisma.clinicSettings.findUnique({
          where: { clinicId },
          select: {
            specialty: true,
            assistantName: true,
            greeting: true,
            whatsappState: true,
          },
        }),
        this.prisma.procedure.count({ where: { clinicId, active: true } }),
        this.prisma.tag.count({ where: { clinicId } }),
        this.integrations.hasUsableProvider(clinicId),
        this.prisma.automationSettings.findUnique({
          where: { clinicId },
          select: { reviewedAt: true },
        }),
      ]);

    const done: Record<OnboardingStep, boolean> = {
      identidade:
        filled(settings?.specialty) &&
        filled(settings?.assistantName) &&
        filled(settings?.greeting),
      procedimentos: procedures > 0,
      tags: tags > 0,
      whatsapp: settings?.whatsappState === 'conectado',
      agenda: agendaReady,
      automacoes: Boolean(automations?.reviewedAt),
    };

    const items: OnboardingChecklistItem[] = [
      {
        key: 'identidade',
        label: 'Apresentar a empresa e o assistente',
        description:
          'Especialidade, nome do assistente e saudação — é o que o agente diz de si.',
        done: done.identidade,
        href: '/settings?tab=identidade',
      },
      {
        key: 'procedimentos',
        label: 'Cadastrar os serviços',
        description:
          'Pelo menos um procedimento ativo para o agente sugerir e agendar.',
        done: done.procedimentos,
        href: '/settings?tab=procedimentos',
      },
      {
        key: 'tags',
        label: 'Definir as tags de interesse',
        description:
          'Pelo menos uma tag para as conversas serem classificadas sozinhas.',
        done: done.tags,
        href: '/settings?tab=tags',
      },
      {
        key: 'whatsapp',
        label: 'Conectar o WhatsApp',
        description: 'Parear o número dedicado da empresa pelo QR code.',
        done: done.whatsapp,
        href: '/settings?tab=whatsapp',
      },
      {
        key: 'agenda',
        label: 'Conectar a agenda',
        description:
          'Google Agenda ou Clinicorp ligados — sem isso o agente não marca horário real.',
        done: done.agenda,
        href: '/settings?tab=integracao',
      },
      {
        key: 'automacoes',
        label: 'Revisar as automações',
        description:
          'Conferir lembretes, janela de envio e textos, e salvar pelo menos uma vez.',
        done: done.automacoes,
        href: '/settings?tab=automacoes',
      },
    ];

    const doneCount = items.filter((i) => i.done).length;
    return {
      items,
      done: doneCount,
      total: items.length,
      complete: doneCount === items.length,
    };
  }
}

function filled(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}
