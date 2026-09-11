import { Injectable } from '@nestjs/common';
import {
  type AutomationSettings,
  DEFAULT_AUTOMATION_SETTINGS,
  type UpdateAutomationSettingsInput,
} from '@dentaltrack/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Linha de `automation_settings` como o Prisma a devolve. */
type SettingsRow = {
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  skipHolidays: boolean;
  skipWeekends: boolean;
  dailyCap: number;
  reminder3dEnabled: boolean;
  reminder3dTemplate: string;
  reminder1dEnabled: boolean;
  reminder1dTemplate: string;
  reminder1hEnabled: boolean;
  reminder1hTemplate: string;
  lateEnabled: boolean;
  lateToleranceMinutes: number;
  lateTemplate: string;
  noShowEnabled: boolean;
  noShowAttempts: number;
  noShowIntervalHours: number;
  noShowTemplate: string;
  recallEnabled: boolean;
  recallAfterDays: number;
  recallKeywords: string[];
  recallTemplate: string;
};

/**
 * Configuração das automações por empresa (F9).
 *
 * A linha é criada sob demanda com os padrões de fábrica (`DEFAULT_AUTOMATION_
 * SETTINGS`) — nenhuma empresa precisa passar por um assistente de configuração
 * para os lembretes começarem a funcionar, e o aviso de atraso já nasce
 * desligado, que é o padrão seguro.
 */
@Injectable()
export class AutomationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Configuração da empresa, criando a linha padrão no primeiro acesso. */
  async get(clinicId: string): Promise<AutomationSettings> {
    const existing = await this.prisma.automationSettings.findUnique({
      where: { clinicId },
    });
    if (existing) return toSettings(existing);

    const created = await this.prisma.automationSettings.upsert({
      where: { clinicId },
      create: { clinicId, ...toRow(DEFAULT_AUTOMATION_SETTINGS) },
      update: {},
    });
    return toSettings(created);
  }

  /** Atualização parcial — o que não vier no corpo fica como está. */
  async update(
    clinicId: string,
    input: UpdateAutomationSettingsInput,
  ): Promise<AutomationSettings> {
    // Garante a linha (e os padrões) antes de aplicar o patch.
    const current = await this.get(clinicId);
    const merged: AutomationSettings = {
      ...current,
      ...input,
      lembrete3d: { ...current.lembrete3d, ...input.lembrete3d },
      lembrete1d: { ...current.lembrete1d, ...input.lembrete1d },
      lembrete1h: { ...current.lembrete1h, ...input.lembrete1h },
      atraso: { ...current.atraso, ...input.atraso },
      falta: { ...current.falta, ...input.falta },
      retorno: { ...current.retorno, ...input.retorno },
    };

    const updated = await this.prisma.automationSettings.update({
      where: { clinicId },
      // Só o caminho explícito de edição marca a revisão. `get()` e o
      // planejador podem criar a linha padrão sem interação humana.
      data: { ...toRow(merged), reviewedAt: new Date() },
    });
    return toSettings(updated);
  }
}

/** Linha do banco → contrato compartilhado. */
export function toSettings(row: SettingsRow): AutomationSettings {
  return {
    timezone: row.timezone,
    sendWindowStart: row.sendWindowStart,
    sendWindowEnd: row.sendWindowEnd,
    skipHolidays: row.skipHolidays,
    skipWeekends: row.skipWeekends,
    dailyCap: row.dailyCap,
    lembrete3d: {
      enabled: row.reminder3dEnabled,
      template: row.reminder3dTemplate,
    },
    lembrete1d: {
      enabled: row.reminder1dEnabled,
      template: row.reminder1dTemplate,
    },
    lembrete1h: {
      enabled: row.reminder1hEnabled,
      template: row.reminder1hTemplate,
    },
    atraso: {
      enabled: row.lateEnabled,
      toleranceMinutes: row.lateToleranceMinutes,
      template: row.lateTemplate,
    },
    falta: {
      enabled: row.noShowEnabled,
      attempts: row.noShowAttempts,
      intervalHours: row.noShowIntervalHours,
      template: row.noShowTemplate,
    },
    retorno: {
      enabled: row.recallEnabled,
      afterDays: row.recallAfterDays,
      procedureKeywords: row.recallKeywords,
      template: row.recallTemplate,
    },
  };
}

/** Contrato compartilhado → colunas do banco. */
export function toRow(settings: AutomationSettings): SettingsRow {
  return {
    timezone: settings.timezone,
    sendWindowStart: settings.sendWindowStart,
    sendWindowEnd: settings.sendWindowEnd,
    skipHolidays: settings.skipHolidays,
    skipWeekends: settings.skipWeekends,
    dailyCap: settings.dailyCap,
    reminder3dEnabled: settings.lembrete3d.enabled,
    reminder3dTemplate: settings.lembrete3d.template,
    reminder1dEnabled: settings.lembrete1d.enabled,
    reminder1dTemplate: settings.lembrete1d.template,
    reminder1hEnabled: settings.lembrete1h.enabled,
    reminder1hTemplate: settings.lembrete1h.template,
    lateEnabled: settings.atraso.enabled,
    lateToleranceMinutes: settings.atraso.toleranceMinutes,
    lateTemplate: settings.atraso.template,
    noShowEnabled: settings.falta.enabled,
    noShowAttempts: settings.falta.attempts,
    noShowIntervalHours: settings.falta.intervalHours,
    noShowTemplate: settings.falta.template,
    recallEnabled: settings.retorno.enabled,
    recallAfterDays: settings.retorno.afterDays,
    recallKeywords: settings.retorno.procedureKeywords,
    recallTemplate: settings.retorno.template,
  };
}
