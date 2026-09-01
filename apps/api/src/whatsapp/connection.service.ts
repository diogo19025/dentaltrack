import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  WhatsappConnection,
  WhatsappConnectionState,
  WhatsappOnboardingAnswer,
} from '@dentaltrack/shared';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from './evolution.service';

/** Tamanho máximo do nome de instância (a Evolution usa isso em rotas). */
const MAX_INSTANCE_NAME = 40;

/**
 * Conexão do número de WhatsApp da empresa (F10) — o pareamento por QR que
 * antes era um procedimento de terminal (docs/WHATSAPP.md §3–5).
 *
 * Três coisas que o procedimento manual fazia e agora acontecem sozinhas:
 * criar a instância **já com o webhook apontado para cá**, pedir o QR e gravar
 * o vínculo `instância → empresa`. O nome da instância é **derivado da
 * empresa**, nunca digitado: era exatamente o passo manual que prendia o
 * produto em "um número, uma clínica".
 *
 * Tudo escopado por `clinicId` (vem do TenantGuard, nunca do corpo).
 */
@Injectable()
export class WhatsappConnectionService {
  private readonly logger = new Logger(WhatsappConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Estado atual da conexão — o que a tela consulta em laço. */
  async getStatus(clinicId: string): Promise<WhatsappConnection> {
    const clinic = await this.loadClinic(clinicId);
    const base = {
      instanceName: clinic.whatsappInstance,
      phone: null,
      qrCode: null,
      pairingCode: null,
      onboardingAnswered: clinic.whatsappOnboardingAnsweredAt !== null,
      serverReady: this.serverReady(),
      lastError: null,
    };

    if (!clinic.whatsappInstance || !this.evolution.isConfigured()) {
      return { ...base, state: 'nao_configurado' };
    }

    try {
      const [stateResponse, instanceResponse] = await Promise.all([
        this.evolution.connectionState(clinic.whatsappInstance),
        this.evolution.fetchInstance(clinic.whatsappInstance),
      ]);
      return {
        ...base,
        state: toConnectionState(readField(stateResponse, 'state')),
        phone: readPhone(instanceResponse),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Não foi possível ler o estado do WhatsApp da empresa ${clinicId}: ${detail}`,
      );
      // A instância existe do nosso lado; a Evolution é que não respondeu.
      // Reportar "desconectado" com o motivo é mais honesto do que "conectado".
      return { ...base, state: 'desconectado', lastError: detail };
    }
  }

  /**
   * Cria a instância se preciso e devolve um QR para parear. Idempotente: com o
   * número já conectado, não recria nada — só informa o estado.
   *
   * Chamar de novo é o caminho normal de "o QR expirou": a Evolution devolve um
   * código novo a cada chamada.
   */
  async connect(clinicId: string): Promise<WhatsappConnection> {
    if (!this.evolution.isConfigured()) {
      throw new ServiceUnavailableException(
        'O servidor não tem o WhatsApp configurado (EVOLUTION_API_URL / EVOLUTION_API_KEY).',
      );
    }
    const webhookUrl = this.webhookUrl();
    if (!webhookUrl) {
      throw new ServiceUnavailableException(
        'Falta configurar a URL pública desta API (API_PUBLIC_URL) para apontar o webhook da instância.',
      );
    }

    const clinic = await this.loadClinic(clinicId);
    const current = await this.getStatus(clinicId);
    if (current.state === 'conectado') return current;

    const instanceName =
      clinic.whatsappInstance ?? this.buildInstanceName(clinicId, clinic.name);

    // A instância pode já existir (reconexão, QR expirado) — nesse caso só
    // pedimos um QR novo. `createInstance` numa que existe devolve 403.
    const exists = clinic.whatsappInstance
      ? await this.instanceExists(instanceName)
      : false;

    let response: unknown;
    try {
      response = exists
        ? await this.evolution.connectInstance(instanceName)
        : await this.evolution.createInstance(instanceName, {
            url: webhookUrl,
            token: this.config.get('EVOLUTION_WEBHOOK_TOKEN', { infer: true }),
          });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Falha ao preparar o pareamento da empresa ${clinicId}: ${detail}`,
      );
      throw new ServiceUnavailableException(
        `Não foi possível preparar a conexão com o WhatsApp agora. ${detail}`,
      );
    }

    // Grava o vínculo instância → empresa (é o que o webhook usa para resolver
    // o tenant) e marca que a pergunta do 1º acesso foi respondida.
    await this.link(clinicId, instanceName);

    const qrCode = readQrCode(response);
    return {
      state: qrCode ? 'aguardando_leitura' : 'desconectado',
      instanceName,
      phone: null,
      qrCode,
      pairingCode: readField(response, 'pairingCode'),
      onboardingAnswered: true,
      serverReady: true,
      lastError: qrCode
        ? null
        : 'A Evolution não devolveu o QR code. Tente novamente em instantes.',
    };
  }

  /** Desconecta o número, mantendo a instância (permite reparear depois). */
  async disconnect(clinicId: string): Promise<WhatsappConnection> {
    const clinic = await this.loadClinic(clinicId);
    if (!clinic.whatsappInstance) {
      throw new BadRequestException('Esta empresa não tem WhatsApp conectado.');
    }
    try {
      await this.evolution.logoutInstance(clinic.whatsappInstance);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Falha ao desconectar ${clinic.whatsappInstance}: ${detail}`,
      );
    }
    return this.getStatus(clinicId);
  }

  /**
   * Remove a instância e desfaz o vínculo. Usado quando a empresa troca de
   * número — deixar a instância órfã na Evolution acumularia sessões mortas.
   */
  async reset(clinicId: string): Promise<WhatsappConnection> {
    const clinic = await this.loadClinic(clinicId);
    if (clinic.whatsappInstance) {
      try {
        await this.evolution.deleteInstance(clinic.whatsappInstance);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        // Instância já inexistente na Evolution não impede limpar o nosso lado.
        this.logger.warn(
          `Falha ao remover a instância ${clinic.whatsappInstance}: ${detail}`,
        );
      }
      await this.prisma.clinicSettings.updateMany({
        where: { clinicId },
        data: { whatsappInstance: null },
      });
    }
    return this.getStatus(clinicId);
  }

  /**
   * Registra a resposta do dono à pergunta do primeiro acesso. `nao_tem` só
   * marca que ele foi perguntado — o produto segue inteiro no canal web, e
   * repetir a pergunta a cada login seria implicância.
   */
  async answerOnboarding(
    clinicId: string,
    answer: WhatsappOnboardingAnswer,
  ): Promise<WhatsappConnection> {
    await this.markAnswered(clinicId);
    if (answer === 'nao_tem') return this.getStatus(clinicId);
    return this.connect(clinicId);
  }

  /** A instância existe na Evolution? (Sessão apagada por lá, por exemplo.) */
  private async instanceExists(instanceName: string): Promise<boolean> {
    try {
      const response = await this.evolution.fetchInstance(instanceName);
      const rows = Array.isArray(response) ? response : [response];
      return rows.some((row) => readField(row, 'instanceName') !== null);
    } catch {
      return false;
    }
  }

  private async loadClinic(clinicId: string): Promise<{
    name: string;
    whatsappInstance: string | null;
    whatsappOnboardingAnsweredAt: Date | null;
  }> {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: {
        name: true,
        settings: {
          select: {
            whatsappInstance: true,
            whatsappOnboardingAnsweredAt: true,
          },
        },
      },
    });
    return {
      name: clinic.name,
      whatsappInstance: clinic.settings?.whatsappInstance ?? null,
      whatsappOnboardingAnsweredAt:
        clinic.settings?.whatsappOnboardingAnsweredAt ?? null,
    };
  }

  private async link(clinicId: string, instanceName: string): Promise<void> {
    await this.prisma.clinicSettings.upsert({
      where: { clinicId },
      create: {
        clinicId,
        whatsappInstance: instanceName,
        whatsappOnboardingAnsweredAt: new Date(),
      },
      update: {
        whatsappInstance: instanceName,
        whatsappOnboardingAnsweredAt: new Date(),
      },
    });
  }

  private async markAnswered(clinicId: string): Promise<void> {
    await this.prisma.clinicSettings.upsert({
      where: { clinicId },
      create: { clinicId, whatsappOnboardingAnsweredAt: new Date() },
      update: { whatsappOnboardingAnsweredAt: new Date() },
    });
  }

  /**
   * Nome da instância a partir da empresa: legível na Evolution e único por
   * construção (o sufixo vem do id da empresa). Nunca digitado por ninguém.
   */
  buildInstanceName(clinicId: string, clinicName: string): string {
    const suffix = clinicId.replace(/-/g, '').slice(0, 8);
    const slug = clinicName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_INSTANCE_NAME - suffix.length - 1);
    return `${slug || 'empresa'}-${suffix}`;
  }

  private webhookUrl(): string | null {
    const base = this.config.get('API_PUBLIC_URL', { infer: true });
    if (!base) return null;
    return `${base.replace(/\/+$/, '')}/whatsapp/webhook`;
  }

  private serverReady(): boolean {
    return this.evolution.isConfigured() && this.webhookUrl() !== null;
  }
}

/**
 * Leitura tolerante das respostas da Evolution — a forma varia entre versões e
 * entre rotas (ora na raiz, ora aninhada em `instance`). Procura em
 * profundidade pela primeira chave com esse nome, ignorando caixa.
 */
function readField(payload: unknown, key: string): string | null {
  const wanted = key.toLowerCase();
  const visit = (value: unknown, depth: number): string | null => {
    if (depth > 4 || value === null || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (const [name, raw] of Object.entries(value)) {
      if (name.toLowerCase() === wanted) {
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
        if (typeof raw === 'number') return String(raw);
      }
    }
    for (const raw of Object.values(value)) {
      const found = visit(raw, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return visit(payload, 0);
}

/** QR como data URI. A Evolution devolve `base64` já com o prefixo, ou sem. */
function readQrCode(payload: unknown): string | null {
  const base64 = readField(payload, 'base64');
  if (!base64) return null;
  return base64.startsWith('data:')
    ? base64
    : `data:image/png;base64,${base64}`;
}

/** Número pareado, sem o sufixo de JID (`@s.whatsapp.net`). */
function readPhone(payload: unknown): string | null {
  const raw =
    readField(payload, 'ownerJid') ??
    readField(payload, 'owner') ??
    readField(payload, 'number');
  if (!raw) return null;
  const digits = raw.split('@')[0].replace(/\D/g, '');
  return digits || null;
}

/** Estado da Evolution → estado do nosso domínio. */
function toConnectionState(state: string | null): WhatsappConnectionState {
  switch (state?.toLowerCase()) {
    case 'open':
      return 'conectado';
    case 'connecting':
      return 'aguardando_leitura';
    case 'close':
    case 'closed':
      return 'desconectado';
    default:
      return 'desconectado';
  }
}

export { readField, readPhone, readQrCode, toConnectionState };
