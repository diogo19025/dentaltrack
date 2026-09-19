import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AGENDA_ERROR_LABELS,
  type AppointmentStatus,
  type ClinicorpCredentials,
  type ConnectionCheck,
  type ConnectionStep,
  type ExternalCategory,
  type ExternalProcedure,
  type ExternalProfessional,
  type ExternalStatus,
  type ExternalUnit,
  mirrorsProfessionals,
  type GoogleAgendaConfig,
  type IntegrationProvider,
  type IntegrationStatus,
  type StatusMapping,
  type UpdateIntegrationInput,
  googleAgendaConfigSchema,
  statusMappingSchema,
} from '@dentaltrack/shared';
import { getContext } from '../common/request-context';
import { DEFAULT_TIMEZONE } from '../common/time';
import type { Env } from '../config/env.validation';
import { GoogleAgendaProvider } from '../google-agenda/google-agenda.provider';
import { GoogleCalendarClient } from '../google-agenda/google-calendar.client';
import { PrismaService } from '../prisma/prisma.service';
import { ProfessionalsService } from '../professionals/professionals.service';
import { agendaErrorKind, type AgendaProvider } from './agenda-provider';
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

/** Linha de integração como o Prisma a devolve (o que usamos dela). */
interface IntegrationRow {
  provider: IntegrationProvider;
  mode: 'desligado' | 'mock' | 'live';
  credentials: string | null;
  unitId: string | null;
  professionalId: string | null;
  categoryExternalId?: string | null;
  lastCheckedAt?: Date | null;
  lastError?: string | null;
}

/**
 * Configuração e resolução da integração de agenda (F9 · Clinicorp;
 * F12 · Google Agenda).
 *
 * É a fronteira entre "o que a empresa configurou" e "de onde a agenda vem".
 * Quem precisa da agenda pede `getProvider(clinicId)` e recebe o adapter certo
 * — Clinicorp, Google, simulado ou nenhum — sem nunca saber qual é.
 *
 * **Só um provedor fica ativo por vez** (modo ≠ desligado): duas agendas
 * simultâneas seriam duas fontes de verdade em conflito. Ligar um desliga o
 * outro, e a tela deixa isso explícito antes de salvar.
 */
@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);
  /**
   * Agenda simulada por empresa (P1.2). O `MockAgendaProvider` guarda em
   * memória o que foi criado, cancelado e remarcado na sessão; instanciá-lo a
   * cada `getProvider()` fazia a agenda demo se contradizer entre chamadas —
   * o agente marcava um horário e a tela seguinte não o via. A chave inclui o
   * fuso porque ele é parâmetro do construtor: trocá-lo recria a agenda.
   */
  private readonly mockProviders = new Map<
    string,
    { timeZone: string; provider: MockAgendaProvider }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly professionals: ProfessionalsService,
  ) {}

  /**
   * Adapter de agenda da empresa, ou `null` quando nenhuma integração está
   * ligada (o chamador cai para a disponibilidade declarada em `/settings`).
   */
  async getProvider(clinicId: string): Promise<AgendaProvider | null> {
    const row = await this.activeRow(clinicId);
    if (!row) return null;

    const { provider, reason } = await this.resolveProvider(clinicId, row);
    if (!provider && reason) {
      this.logger.warn(`Empresa ${clinicId}: ${reason}`);
    }
    return provider;
  }

  /**
   * Verdade operacional usada pelo onboarding: uma linha ativa não basta.
   * `live` só conta depois de uma verificação bem-sucedida; credencial
   * ausente, configuração incompleta ou o último check com erro continuam
   * retornando `false`. `mock` é utilizável imediatamente.
   */
  async hasUsableProvider(clinicId: string): Promise<boolean> {
    const row = await this.activeRow(clinicId);
    if (!row) return false;
    if (row.mode === 'mock') return true;
    if (!row.lastCheckedAt || row.lastError) return false;
    return (await this.resolveProvider(clinicId, row)).provider !== null;
  }

  /** Provedor ativo (modo ≠ desligado) da empresa, se houver. */
  async activeProviderName(
    clinicId: string,
  ): Promise<IntegrationProvider | null> {
    const row = await this.activeRow(clinicId);
    return row?.provider ?? null;
  }

  /** Estado do provedor ativo (ou do Clinicorp, se nenhum estiver ligado). */
  async activeStatus(clinicId: string): Promise<IntegrationStatus> {
    const active = await this.activeRow(clinicId);
    return this.getStatus(clinicId, active?.provider ?? 'clinicorp');
  }

  /** Estado da integração para a tela — sem nenhum segredo. */
  async getStatus(
    clinicId: string,
    provider: IntegrationProvider,
  ): Promise<IntegrationStatus> {
    const row = await this.prisma.clinicIntegration.findUnique({
      where: { clinicId_provider: { clinicId, provider } },
    });
    const active = await this.activeRow(clinicId);
    const google =
      provider === 'google'
        ? this.readGoogleConfig(row?.credentials ?? null)
        : null;
    const credentials =
      provider === 'clinicorp'
        ? this.readClinicorpCredentials(row?.credentials ?? null)
        : null;
    const professionalId =
      provider === 'clinicorp'
        ? await this.professionals.resolveExternalId(
            clinicId,
            row?.professionalId,
            { unitExternalId: row?.unitId },
          )
        : (row?.professionalId ?? null);

    return {
      provider,
      mode: row?.mode ?? 'desligado',
      activeProvider: active?.provider ?? null,
      hasCredentials:
        provider === 'google' ? Boolean(google) : Boolean(credentials),
      usernameHint: credentials ? maskUsername(credentials.username) : null,
      google,
      serviceAccountEmail: this.serviceAccountEmail(),
      unitId: row?.unitId ?? null,
      professionalId,
      categoryExternalId: row?.categoryExternalId ?? null,
      statusMappings: parseStatusMappings(row?.statusMappings),
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  /**
   * Salva a configuração. Credencial omitida mantém a que já está guardada —
   * o operador precisa poder trocar a unidade sem redigitar o token (que a tela
   * nunca recebeu de volta). Ligar um provedor **desliga o outro**.
   */
  async update(
    clinicId: string,
    provider: IntegrationProvider,
    input: UpdateIntegrationInput,
  ): Promise<IntegrationStatus> {
    const current = await this.prisma.clinicIntegration.findUnique({
      where: { clinicId_provider: { clinicId, provider } },
    });
    // Cada provedor guarda a sua configuração no mesmo campo cifrado; o corpo
    // do outro provedor é ignorado em vez de misturado.
    const secret =
      provider === 'clinicorp'
        ? input.credentials != null
          ? JSON.stringify(input.credentials)
          : undefined
        : input.google !== undefined
          ? input.google === null
            ? null
            : JSON.stringify(googleAgendaConfigSchema.parse(input.google))
          : undefined;
    const encrypted =
      secret === undefined
        ? undefined
        : secret === null
          ? null
          : encryptSecret(secret, this.encryptionKey());

    const googleConfigChanged =
      provider === 'google' && input.google !== undefined
        ? JSON.stringify(
            input.google === null
              ? null
              : googleAgendaConfigSchema.parse(input.google),
          ) !==
          JSON.stringify(this.readGoogleConfig(current?.credentials ?? null))
        : false;
    const connectionChanged =
      (input.mode !== undefined &&
        input.mode !== (current?.mode ?? 'desligado')) ||
      (provider === 'clinicorp' && input.credentials != null) ||
      googleConfigChanged;
    const professionalId =
      provider === 'clinicorp' && input.professionalId !== undefined
        ? await this.professionals.resolveExternalId(
            clinicId,
            input.professionalId,
            {
              unitExternalId:
                input.unitId !== undefined ? input.unitId : current?.unitId,
            },
          )
        : input.professionalId;

    const data = {
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(encrypted !== undefined ? { credentials: encrypted } : {}),
      ...(input.unitId !== undefined ? { unitId: input.unitId } : {}),
      ...(input.professionalId !== undefined ? { professionalId } : {}),
      ...(input.categoryExternalId !== undefined
        ? { categoryExternalId: input.categoryExternalId }
        : {}),
      ...(input.statusMappings !== undefined
        ? { statusMappings: input.statusMappings }
        : {}),
      ...(connectionChanged ? { lastCheckedAt: null, lastError: null } : {}),
    };

    await this.prisma.clinicIntegration.upsert({
      where: { clinicId_provider: { clinicId, provider } },
      create: { clinicId, provider, ...data },
      update: data,
    });

    if (input.mode !== undefined && input.mode !== 'desligado') {
      await this.prisma.clinicIntegration.updateMany({
        where: {
          clinicId,
          provider: { not: provider },
          mode: { not: 'desligado' },
        },
        data: { mode: 'desligado' },
      });
    }

    return this.getStatus(clinicId, provider);
  }

  /**
   * Verificação de conexão — a tradução em tela do `clinicorp:smoke`.
   *
   * Roda a cadeia **só-leitura** e reporta passo a passo o que respondeu e o que
   * divergiu. É assim que a verdade sobre a API aparece em cinco minutos no dia
   * em que a credencial chegar, em vez de aparecer depurando em produção. Nunca
   * escreve nada no sistema do cliente.
   */
  async check(
    clinicId: string,
    providerName: IntegrationProvider,
  ): Promise<ConnectionCheck> {
    const status = await this.getStatus(clinicId, providerName);
    const checkedAt = new Date();
    const steps: ConnectionStep[] = [];
    let units: ExternalUnit[] = [];
    let professionals: ExternalProfessional[] = [];
    let statuses: ExternalStatus[] = [];
    let categories: ExternalCategory[] = [];
    let procedures: ExternalProcedure[] = [];

    const row = await this.prisma.clinicIntegration.findUnique({
      where: { clinicId_provider: { clinicId, provider: providerName } },
    });
    const resolved =
      row && row.mode !== 'desligado'
        ? await this.resolveProvider(clinicId, row)
        : {
            provider: null,
            reason:
              'A integração está desligada. Escolha "simulado" ou "real" para verificar.',
          };
    const provider = resolved.provider;

    const requestId = getContext()?.requestId ?? null;

    if (!provider) {
      // Falta configuração deste lado — não houve chamada externa nenhuma.
      steps.push({
        key: 'credenciais',
        label: 'Credenciais e modo',
        ok: false,
        detail: resolved.reason ?? 'A integração não pôde ser montada.',
        kind: 'config',
        durationMs: 0,
      });
      return {
        ok: false,
        mode: status.mode,
        checkedAt: checkedAt.toISOString(),
        steps,
        requestId,
        units,
        professionals,
        statuses,
        categories,
        procedures,
        suggestedMappings: status.statusMappings,
      };
    }

    steps.push({
      key: 'credenciais',
      label: 'Credenciais e modo',
      ok: true,
      detail: provider.live
        ? providerName === 'google'
          ? `Modo real (agenda ${status.google?.calendarId ?? '?'}).`
          : `Modo real${status.usernameHint ? ` (usuário ${status.usernameHint})` : ''}.`
        : 'Modo simulado — nenhuma chamada externa é feita.',
      kind: null,
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
          kind: null,
          durationMs: Date.now() - started,
        });
        return true;
      } catch (err) {
        steps.push({
          key,
          label,
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
          // A categoria é o que faz a tela dizer "revise a credencial" em vez
          // de repetir a mensagem técnica do fornecedor (P0.1).
          kind: agendaErrorKind(err),
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
        // A verificação continua só-leitura **do lado do fornecedor**; o que
        // ela passou a fazer é gravar o espelho aqui. Sem isto a equipe só
        // existia no resultado desta chamada e sumia da tela a cada recarga.
        // O Google não tem profissionais — o único que devolve é a própria
        // agenda, sintético — e espelhá-lo desativaria a equipe de verdade.
        const mirror = mirrorsProfessionals(providerName)
          ? await this.professionals.syncFromProvider(clinicId, professionals)
          : null;
        const changed =
          mirror && mirror.criados + mirror.atualizados + mirror.desativados > 0
            ? ` (${mirror.criados} novo(s), ${mirror.atualizados} atualizado(s), ${mirror.desativados} desativado(s))`
            : '';
        return `${professionals.length} profissional(is)${changed}.`;
      })) &&
      (await run('status', 'Listar status de agendamento', async () => {
        statuses = await provider.listStatuses();
        return `${statuses.length} status: ${statuses.map((s) => s.name).join(', ') || '—'}`;
      })) &&
      (await run('catalogo', 'Ler categorias e procedimentos', async () => {
        // Juntos num passo só: são duas leituras auxiliares, e falhar em
        // qualquer uma não impede a agenda de funcionar — só deixa a tela sem
        // o que oferecer para importar.
        [categories, procedures] = await Promise.all([
          provider.listCategories(),
          provider.listProcedures(),
        ]);
        return `${categories.length} categoria(s) e ${procedures.length} procedimento(s) na conta.`;
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
    // O motivo entra no **mesmo** `lastError` que a tela já exibe (P0.1): a
    // causa em prosa, seguida do detalhe técnico. Guardar a categoria numa
    // coluna nova custaria uma migration para a mesma informação.
    const lastError = ok ? null : describeFailure(steps, requestId);

    await this.prisma.clinicIntegration.updateMany({
      where: { clinicId, provider: providerName },
      data: { lastCheckedAt: checkedAt, lastError },
    });

    return {
      ok,
      mode: status.mode,
      checkedAt: checkedAt.toISOString(),
      steps,
      requestId,
      units,
      professionals,
      statuses,
      categories,
      procedures,
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

  /** Mapeamentos salvos do provedor **ativo** (usado pela sincronização). */
  async statusMappingsOf(clinicId: string): Promise<StatusMapping[]> {
    const row = await this.prisma.clinicIntegration.findFirst({
      where: { clinicId, mode: { not: 'desligado' } },
      orderBy: { updatedAt: 'desc' },
      select: { statusMappings: true },
    });
    return parseStatusMappings(row?.statusMappings);
  }

  /** Registra o resultado de uma sincronização (no provedor ativo). */
  async recordSync(clinicId: string, error: string | null): Promise<void> {
    await this.prisma.clinicIntegration.updateMany({
      where: { clinicId, mode: { not: 'desligado' } },
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

  /**
   * Uma agenda simulada por empresa, viva enquanto o processo viver. Mudar o
   * fuso substitui a instância anterior em vez de deixar caches mortos no Map.
   */
  private mockProviderFor(
    clinicId: string,
    timeZone: string,
  ): MockAgendaProvider {
    const cached = this.mockProviders.get(clinicId);
    if (!cached || cached.timeZone !== timeZone) {
      const provider = new MockAgendaProvider(timeZone);
      this.mockProviders.set(clinicId, { timeZone, provider });
      return provider;
    }
    return cached.provider;
  }

  /** Linha ativa (modo ≠ desligado). A exclusividade é garantida no `update`. */
  private activeRow(clinicId: string) {
    return this.prisma.clinicIntegration.findFirst({
      where: { clinicId, mode: { not: 'desligado' } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Monta o adapter da linha dada. Devolve `reason` em vez de lançar para que
   * o `check` mostre ao operador exatamente o que falta, e o `getProvider`
   * degrade em silêncio (agenda indisponível não pode derrubar o atendimento).
   */
  private async resolveProvider(
    clinicId: string,
    row: IntegrationRow,
  ): Promise<{ provider: AgendaProvider | null; reason?: string }> {
    const timeZone = await this.timeZoneOf(clinicId);
    if (row.mode === 'mock') {
      return { provider: this.mockProviderFor(clinicId, timeZone) };
    }

    if (row.provider === 'google') {
      const config = this.readGoogleConfig(row.credentials);
      if (!config?.calendarId) {
        return {
          provider: null,
          reason:
            'Modo real sem agenda configurada. Informe o ID da agenda do Google.',
        };
      }
      const email = this.config.get('GOOGLE_CALENDAR_SA_EMAIL', {
        infer: true,
      });
      const key = this.config.get('GOOGLE_CALENDAR_SA_KEY', { infer: true });
      if (!email || !key) {
        return {
          provider: null,
          reason:
            'O servidor não tem a service account do Google configurada (GOOGLE_CALENDAR_SA_EMAIL / GOOGLE_CALENDAR_SA_KEY).',
        };
      }
      return {
        provider: new GoogleAgendaProvider(
          new GoogleCalendarClient({
            serviceAccountEmail: email,
            privateKey: key,
          }),
          timeZone,
          config,
        ),
      };
    }

    const credentials = this.readClinicorpCredentials(row.credentials);
    if (!credentials) {
      return {
        provider: null,
        reason:
          'Modo real sem credenciais salvas. Informe usuário, token e Subscriber ID.',
      };
    }
    const professionalId = await this.professionals.resolveExternalId(
      clinicId,
      row.professionalId,
      { unitExternalId: row.unitId },
    );
    return {
      provider: new ClinicorpAgendaProvider(
        new ClinicorpClient(credentials),
        timeZone,
        {
          unitId: row.unitId,
          professionalId,
          categoryName: row.categoryExternalId ?? null,
        },
      ),
    };
  }

  /** E-mail da service account, se o servidor estiver com o Google habilitado. */
  private serviceAccountEmail(): string | null {
    const email = this.config.get('GOOGLE_CALENDAR_SA_EMAIL', { infer: true });
    const key = this.config.get('GOOGLE_CALENDAR_SA_KEY', { infer: true });
    return email && key ? email : null;
  }

  private encryptionKey(): Buffer {
    return loadEncryptionKey(
      this.config.get('INTEGRATION_ENCRYPTION_KEY', { infer: true }),
    );
  }

  /** Decifra as credenciais do Clinicorp; ilegível vira `null` (e um aviso). */
  private readClinicorpCredentials(
    payload: string | null,
  ): ClinicorpCredentials | null {
    const raw = this.decrypt(payload);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ClinicorpCredentials;
    } catch {
      return null;
    }
  }

  /** Decifra e valida a configuração do Google; ilegível vira `null`. */
  private readGoogleConfig(payload: string | null): GoogleAgendaConfig | null {
    const raw = this.decrypt(payload);
    if (!raw) return null;
    try {
      const parsed = googleAgendaConfigSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private decrypt(payload: string | null): string | null {
    if (!payload) return null;
    try {
      return decryptSecret(payload, this.encryptionKey());
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Não foi possível ler as credenciais salvas: ${detail}`,
      );
      return null;
    }
  }
}

/**
 * A falha da verificação em uma linha guardável: causa em prosa, detalhe
 * técnico e o código de correlação.
 *
 * O código vai junto porque `lastError` é o que fica visível dias depois, e sem
 * ele o suporte tem a mensagem mas não tem como achar as linhas de log daquela
 * verificação específica.
 */
function describeFailure(
  steps: ConnectionStep[],
  requestId: string | null,
): string {
  const failed = steps.find((s) => !s.ok);
  if (!failed) return 'Falha desconhecida.';
  const label = AGENDA_ERROR_LABELS[failed.kind ?? 'desconhecido'];
  const code = requestId ? ` [${requestId}]` : '';
  return `${label}: ${failed.detail}${code}`;
}

/** Json do banco → lista validada de mapeamentos (entrada inválida é ignorada). */
function parseStatusMappings(value: unknown): StatusMapping[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = statusMappingSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
