import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AppointmentStatus,
  type ClinicorpCredentials,
  type ConnectionCheck,
  type ConnectionStep,
  type ExternalProfessional,
  type ExternalStatus,
  type ExternalUnit,
  type IntegrationStatus,
  type StatusMapping,
  type UpdateIntegrationInput,
  statusMappingSchema,
} from '@dentaltrack/shared';
import { DEFAULT_TIMEZONE } from '../common/time';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import type { AgendaProvider } from './agenda-provider';
import { ClinicorpClient } from './clinicorp.client';
import { ClinicorpAgendaProvider } from './clinicorp.provider';
import {
  decryptSecret,
  encryptSecret,
  loadEncryptionKey,
  maskUsername,
} from './credentials-crypto';
import { MockAgendaProvider } from './mock.provider';
import { suggestStatusMappings } from './status-heuristics';

/**
 * Configuração e resolução da integração com o sistema de gestão (F9).
 *
 * É a fronteira entre "o que a empresa configurou" e "de onde a agenda vem".
 * Quem precisa da agenda pede `getProvider(clinicId)` e recebe o adapter certo
 * — real, simulado ou nenhum — sem nunca saber qual é.
 *
 * Nenhum identificador externo é fixo no código: unidade, profissional e,
 * principalmente, os **ids de status** são descobertos em execução pelo wizard
 * e mapeados pelo operador. O que numa conta é "Faltou" na outra é "No-show"
 * com outro número, e é justamente o status que decide se a automação dispara.
 */
@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Adapter de agenda da empresa, ou `null` quando a integração está desligada
   * (o chamador cai para a disponibilidade declarada em `/settings`).
   */
  async getProvider(clinicId: string): Promise<AgendaProvider | null> {
    const row = await this.prisma.clinicIntegration.findUnique({
      where: { clinicId_provider: { clinicId, provider: 'clinicorp' } },
    });
    if (!row || row.mode === 'desligado') return null;

    const timeZone = await this.timeZoneOf(clinicId);
    if (row.mode === 'mock') return new MockAgendaProvider(timeZone);

    const credentials = this.readCredentials(row.credentials);
    if (!credentials) {
      this.logger.warn(
        `Empresa ${clinicId} está em modo "live" sem credenciais salvas — agenda indisponível.`,
      );
      return null;
    }
    return new ClinicorpAgendaProvider(
      new ClinicorpClient(credentials),
      timeZone,
      { unitId: row.unitId, professionalId: row.professionalId },
    );
  }

  /** Estado da integração para a tela — sem nenhum segredo. */
  async getStatus(clinicId: string): Promise<IntegrationStatus> {
    const row = await this.prisma.clinicIntegration.findUnique({
      where: { clinicId_provider: { clinicId, provider: 'clinicorp' } },
    });
    const credentials = this.readCredentials(row?.credentials ?? null);
    return {
      provider: 'clinicorp',
      mode: row?.mode ?? 'desligado',
      hasCredentials: Boolean(credentials),
      usernameHint: credentials ? maskUsername(credentials.username) : null,
      unitId: row?.unitId ?? null,
      professionalId: row?.professionalId ?? null,
      statusMappings: parseStatusMappings(row?.statusMappings),
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  /**
   * Salva a configuração. Credencial omitida mantém a que já está guardada —
   * o operador precisa poder trocar a unidade sem redigitar o token (que a tela
   * nunca recebeu de volta).
   */
  async update(
    clinicId: string,
    input: UpdateIntegrationInput,
  ): Promise<IntegrationStatus> {
    const encrypted =
      input.credentials != null
        ? encryptSecret(JSON.stringify(input.credentials), this.encryptionKey())
        : undefined;

    const data = {
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(encrypted !== undefined ? { credentials: encrypted } : {}),
      ...(input.unitId !== undefined ? { unitId: input.unitId } : {}),
      ...(input.professionalId !== undefined
        ? { professionalId: input.professionalId }
        : {}),
      ...(input.statusMappings !== undefined
        ? { statusMappings: input.statusMappings }
        : {}),
    };

    await this.prisma.clinicIntegration.upsert({
      where: { clinicId_provider: { clinicId, provider: 'clinicorp' } },
      create: { clinicId, provider: 'clinicorp', ...data },
      update: data,
    });

    return this.getStatus(clinicId);
  }

  /**
   * Verificação de conexão — a tradução em tela do `clinicorp:smoke`.
   *
   * Roda a cadeia **só-leitura** e reporta passo a passo o que respondeu e o que
   * divergiu. É assim que a verdade sobre a API aparece em cinco minutos no dia
   * em que a credencial chegar, em vez de aparecer depurando em produção. Nunca
   * escreve nada no sistema do cliente.
   */
  async check(clinicId: string): Promise<ConnectionCheck> {
    const status = await this.getStatus(clinicId);
    const checkedAt = new Date();
    const steps: ConnectionStep[] = [];
    let units: ExternalUnit[] = [];
    let professionals: ExternalProfessional[] = [];
    let statuses: ExternalStatus[] = [];

    const provider = await this.getProvider(clinicId);
    if (!provider) {
      steps.push({
        key: 'credenciais',
        label: 'Credenciais e modo',
        ok: false,
        detail:
          status.mode === 'desligado'
            ? 'A integração está desligada. Escolha "simulado" ou "real" para verificar.'
            : 'Modo real sem credenciais salvas. Informe usuário, token e Subscriber ID.',
        durationMs: 0,
      });
      return {
        ok: false,
        mode: status.mode,
        checkedAt: checkedAt.toISOString(),
        steps,
        units,
        professionals,
        statuses,
        suggestedMappings: status.statusMappings,
      };
    }

    steps.push({
      key: 'credenciais',
      label: 'Credenciais e modo',
      ok: true,
      detail: provider.live
        ? `Modo real${status.usernameHint ? ` (usuário ${status.usernameHint})` : ''}.`
        : 'Modo simulado — nenhuma chamada externa é feita.',
      durationMs: 0,
    });

    const run = async (
      key: string,
      label: string,
      action: () => Promise<string>,
    ): Promise<boolean> => {
      const started = Date.now();
      try {
        const detail = await action();
        steps.push({
          key,
          label,
          ok: true,
          detail,
          durationMs: Date.now() - started,
        });
        return true;
      } catch (err) {
        steps.push({
          key,
          label,
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
        });
        return false;
      }
    };

    // Sequencial e parando no primeiro erro: credencial inválida faria todas as
    // etapas seguintes esperarem o timeout, e o operador já tem a resposta.
    const chain =
      (await run('unidades', 'Listar unidades', async () => {
        units = await provider.listUnits();
        return `${units.length} unidade(s): ${units.map((u) => u.name).join(', ') || '—'}`;
      })) &&
      (await run('profissionais', 'Listar profissionais', async () => {
        professionals = await provider.listProfessionals(
          status.unitId ?? units[0]?.id ?? null,
        );
        return `${professionals.length} profissional(is).`;
      })) &&
      (await run('status', 'Listar status de agendamento', async () => {
        statuses = await provider.listStatuses();
        return `${statuses.length} status: ${statuses.map((s) => s.name).join(', ') || '—'}`;
      })) &&
      (await run('disponibilidade', 'Consultar horários livres', async () => {
        const from = new Date();
        const to = new Date(from.getTime() + 7 * 24 * 3_600_000);
        const slots = await provider.listAvailableSlots({
          from,
          to,
          unitId: status.unitId ?? units[0]?.id ?? null,
          limit: 5,
        });
        return slots.length
          ? `${slots.length} horário(s), o primeiro em ${slots[0].startsAt}.`
          : 'Nenhum horário livre nos próximos 7 dias (a agenda respondeu, mas está cheia).';
      })) &&
      (await run('agenda', 'Ler agenda dos próximos 7 dias', async () => {
        const from = new Date();
        const to = new Date(from.getTime() + 7 * 24 * 3_600_000);
        const appointments = await provider.listAppointments({
          from,
          to,
          unitId: status.unitId ?? units[0]?.id ?? null,
        });
        return `${appointments.length} agendamento(s) na janela.`;
      }));

    const ok = chain;
    const lastError = ok
      ? null
      : (steps.find((s) => !s.ok)?.detail ?? 'Falha desconhecida.');

    await this.prisma.clinicIntegration.updateMany({
      where: { clinicId, provider: 'clinicorp' },
      data: { lastCheckedAt: checkedAt, lastError },
    });

    return {
      ok,
      mode: status.mode,
      checkedAt: checkedAt.toISOString(),
      steps,
      units,
      professionals,
      statuses,
      // Sugestão para confirmar, não decisão tomada: o que o operador já
      // escolheu é preservado, e o irreconhecível fica em branco.
      suggestedMappings: suggestStatusMappings(statuses, status.statusMappings),
    };
  }

  /**
   * Traduz o status cru do sistema externo para o nosso domínio, pelo
   * mapeamento do operador. Casa por id e, se não achar, por nome — contas
   * migradas às vezes trocam os ids mas mantêm os nomes.
   *
   * Sem correspondência devolve `null`, que significa "não mexe": um status
   * desconhecido nunca deve reclassificar um agendamento por conta própria.
   */
  translateStatus(
    mappings: StatusMapping[],
    externalId: string | null,
    externalName: string | null,
  ): AppointmentStatus | null {
    const byId = externalId
      ? mappings.find((m) => m.externalId === externalId)
      : undefined;
    if (byId) return byId.status;

    const name = externalName?.trim().toLowerCase();
    if (!name) return null;
    const byName = mappings.find(
      (m) => m.externalName.trim().toLowerCase() === name,
    );
    return byName?.status ?? null;
  }

  /** Mapeamentos salvos da empresa (usado pela sincronização). */
  async statusMappingsOf(clinicId: string): Promise<StatusMapping[]> {
    const row = await this.prisma.clinicIntegration.findUnique({
      where: { clinicId_provider: { clinicId, provider: 'clinicorp' } },
      select: { statusMappings: true },
    });
    return parseStatusMappings(row?.statusMappings);
  }

  /** Registra o resultado de uma sincronização de agenda. */
  async recordSync(clinicId: string, error: string | null): Promise<void> {
    await this.prisma.clinicIntegration.updateMany({
      where: { clinicId, provider: 'clinicorp' },
      data: {
        ...(error ? {} : { lastSyncedAt: new Date() }),
        lastError: error,
      },
    });
  }

  /** Fuso da empresa (das automações), com o padrão brasileiro como fallback. */
  async timeZoneOf(clinicId: string): Promise<string> {
    const row = await this.prisma.automationSettings.findUnique({
      where: { clinicId },
      select: { timezone: true },
    });
    return row?.timezone ?? DEFAULT_TIMEZONE;
  }

  private encryptionKey(): Buffer {
    return loadEncryptionKey(
      this.config.get('INTEGRATION_ENCRYPTION_KEY', { infer: true }),
    );
  }

  /** Decifra as credenciais; formato ilegível vira `null` (e um aviso). */
  private readCredentials(payload: string | null): ClinicorpCredentials | null {
    if (!payload) return null;
    try {
      const raw = decryptSecret(payload, this.encryptionKey());
      return JSON.parse(raw) as ClinicorpCredentials;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Não foi possível ler as credenciais salvas: ${detail}`,
      );
      return null;
    }
  }
}

/** Json do banco → lista validada de mapeamentos (entrada inválida é ignorada). */
function parseStatusMappings(value: unknown): StatusMapping[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = statusMappingSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
