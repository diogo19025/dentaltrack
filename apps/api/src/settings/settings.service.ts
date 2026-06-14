import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type ClinicSettingsDto,
  DEFAULT_AVAILABILITY,
  TONES,
  type Tone,
  type UpdateSettingsInput,
} from '@dentaltrack/shared';
import type { Clinic, ClinicSettings } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Tom padrão quando a clínica ainda não escolheu (espelha o design). */
const DEFAULT_TONE: Tone = 'amigavel';

/**
 * Serviço de Configurações do bot (BE-2.1). Tudo escopado por `clinicId`.
 * Os dados alimentam o system prompt (BE-1.3) — ver `ai/prompt.ts`. O nome da
 * clínica mora em `Clinic`; o restante em `ClinicSettings` (1:1, opcional).
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lê as configurações da clínica, preenchendo defaults p/ campos vazios. */
  async getSettings(clinicId: string): Promise<ClinicSettingsDto> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      include: { settings: true },
    });
    if (!clinic)
      throw new NotFoundException(`Clínica ${clinicId} não encontrada.`);
    return this.toDto(clinic, clinic.settings);
  }

  /**
   * Atualiza as configurações (parcial). O nome da clínica vai para `Clinic`;
   * o restante para `ClinicSettings` (criado on-demand via upsert).
   */
  async updateSettings(
    clinicId: string,
    input: UpdateSettingsInput,
  ): Promise<ClinicSettingsDto> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
    });
    if (!clinic)
      throw new NotFoundException(`Clínica ${clinicId} não encontrada.`);

    const { clinicName, availability, ...rest } = input;

    // Só inclui no upsert os campos realmente enviados (atualização parcial).
    const settingsData = {
      ...rest,
      ...(availability !== undefined ? { availability } : {}),
    };

    const [updatedClinic, settings] = await this.prisma.$transaction([
      this.prisma.clinic.update({
        where: { id: clinicId },
        data: clinicName !== undefined ? { name: clinicName } : {},
      }),
      this.prisma.clinicSettings.upsert({
        where: { clinicId },
        create: { clinicId, ...settingsData },
        update: settingsData,
      }),
    ]);

    return this.toDto(updatedClinic, settings);
  }

  /** Normaliza linha do banco → DTO (sem nulls; tom e disponibilidade válidos). */
  private toDto(
    clinic: Clinic,
    settings: ClinicSettings | null,
  ): ClinicSettingsDto {
    const tone = settings?.tone;
    return {
      clinicName: clinic.name,
      specialty: settings?.specialty ?? '',
      description: settings?.description ?? '',
      assistantName: settings?.assistantName ?? '',
      tone: TONES.includes(tone as Tone) ? (tone as Tone) : DEFAULT_TONE,
      greeting: settings?.greeting ?? '',
      instructions: settings?.instructions ?? '',
      offerEnabled: settings?.offerEnabled ?? false,
      offerText: settings?.offerText ?? '',
      offerStartsOn: settings?.offerStartsOn ?? '',
      offerEndsOn: settings?.offerEndsOn ?? '',
      availability: this.normalizeAvailability(settings?.availability),
      whatsappInstance: settings?.whatsappInstance ?? '',
    };
  }

  /** Aceita o Json do banco e devolve sempre uma lista válida (ou o default). */
  private normalizeAvailability(
    value: unknown,
  ): ClinicSettingsDto['availability'] {
    if (!Array.isArray(value)) return DEFAULT_AVAILABILITY;
    const slots = value.filter(
      (s): s is { day: string; hours: string; open: boolean } =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as { day?: unknown }).day === 'string',
    );
    return slots.length > 0
      ? slots.map((s) => ({
          day: s.day,
          hours: s.hours ?? '',
          open: Boolean(s.open),
        }))
      : DEFAULT_AVAILABILITY;
  }
}
