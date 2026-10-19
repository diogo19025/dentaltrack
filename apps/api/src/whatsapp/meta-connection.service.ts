import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  MetaConnection,
  SaveMetaCredentialsInput,
  WhatsappProvider,
} from '@dentaltrack/shared';
import {
  encryptSecret,
  loadEncryptionKey,
  MissingEncryptionKeyError,
} from '../clinicorp/credentials-crypto';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { MetaRequestError, MetaTransport } from './transport/meta.transport';

/**
 * Credenciais da Cloud API da Meta por empresa (cadastro manual). O token é
 * validado contra a Meta antes de ser guardado e cifrado com a mesma chave das
 * integrações; depois de salvo, só se sabe que existe um — nunca volta ao
 * navegador. Tudo escopado por `clinicId` (vem do TenantGuard).
 *
 * Salvar credencial **não** troca o provedor: o número pareado por QR code e a
 * Meta coexistem, e qual dos dois atende é escolha explícita do dono
 * (`setProvider`). Assim dá para cadastrar a Meta, testar e voltar, sem perder
 * nenhuma das duas configurações.
 */
@Injectable()
export class MetaConnectionService {
  private readonly logger = new Logger(MetaConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async getStatus(clinicId: string): Promise<MetaConnection> {
    const s = await this.prisma.clinicSettings.findUnique({
      where: { clinicId },
      select: {
        whatsappProvider: true,
        metaPhoneNumberId: true,
        metaWabaId: true,
        metaAccessTokenEnc: true,
        metaDisplayPhone: true,
        metaVerifiedName: true,
      },
    });
    return {
      provider: s?.whatsappProvider === 'meta' ? 'meta' : 'evolution',
      phoneNumberId: s?.metaPhoneNumberId ?? null,
      wabaId: s?.metaWabaId ?? null,
      tokenSaved: Boolean(s?.metaAccessTokenEnc),
      displayPhone: s?.metaDisplayPhone ?? null,
      verifiedName: s?.metaVerifiedName ?? null,
      serverReady: this.serverReady(),
      webhookUrl: this.webhookUrl(),
    };
  }

  /** Valida na Meta e guarda o token cifrado. O provedor ativo não muda. */
  async save(
    clinicId: string,
    input: SaveMetaCredentialsInput,
  ): Promise<MetaConnection> {
    if (!this.serverReady()) {
      throw new ServiceUnavailableException(
        'O servidor não tem a Meta configurada (META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, INTEGRATION_ENCRYPTION_KEY e API_PUBLIC_URL).',
      );
    }

    const transport = new MetaTransport(
      input.phoneNumberId,
      input.accessToken,
      this.config.get('META_GRAPH_VERSION', { infer: true }),
    );
    let info: { displayPhone: string | null; verifiedName: string | null };
    try {
      info = await transport.fetchPhoneInfo();
    } catch (err) {
      // Mensagem da Meta ao dono: token errado, ID errado e falta de permissão
      // são o que ele precisa corrigir; nada disso é erro nosso.
      const detail =
        err instanceof MetaRequestError
          ? err.message
          : 'Falha ao falar com a Meta.';
      throw new BadRequestException(
        `A Meta recusou estas credenciais: ${detail}`,
      );
    }

    let encrypted: string;
    try {
      encrypted = encryptSecret(
        input.accessToken,
        loadEncryptionKey(
          this.config.get('INTEGRATION_ENCRYPTION_KEY', { infer: true }),
        ),
      );
    } catch (err) {
      if (err instanceof MissingEncryptionKeyError) {
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

    const data = {
      metaPhoneNumberId: input.phoneNumberId,
      metaWabaId: input.wabaId,
      metaAccessTokenEnc: encrypted,
      metaDisplayPhone: info.displayPhone,
      metaVerifiedName: info.verifiedName,
    };
    try {
      await this.prisma.clinicSettings.upsert({
        where: { clinicId },
        create: { clinicId, ...data },
        update: data,
      });
    } catch (err) {
      if ((err as { code?: unknown }).code === 'P2002') {
        // O ID do número resolve a empresa no webhook: dois donos do mesmo ID
        // fariam mensagens de uma empresa caírem na outra.
        throw new ConflictException(
          'Este número já está conectado a outra empresa.',
        );
      }
      throw err;
    }
    this.logger.log({ event: 'whatsapp.meta.connected', outcome: 'ok' });
    return this.getStatus(clinicId);
  }

  /**
   * Escolhe o provedor que atende e envia pela empresa. `meta` exige credencial
   * salva — sem ela a empresa ficaria muda, com o webhook da Meta resolvendo a
   * clínica e nenhum transporte para responder.
   */
  async setProvider(
    clinicId: string,
    provider: WhatsappProvider,
  ): Promise<MetaConnection> {
    if (provider === 'meta') {
      const s = await this.prisma.clinicSettings.findUnique({
        where: { clinicId },
        select: { metaPhoneNumberId: true, metaAccessTokenEnc: true },
      });
      if (!s?.metaPhoneNumberId || !s.metaAccessTokenEnc) {
        throw new UnprocessableEntityException(
          'Salve as credenciais da Meta antes de ativá-la.',
        );
      }
    }
    await this.prisma.clinicSettings.upsert({
      where: { clinicId },
      create: { clinicId, whatsappProvider: provider },
      update: { whatsappProvider: provider },
    });
    this.logger.log({ event: 'whatsapp.provider', outcome: 'ok', provider });
    return this.getStatus(clinicId);
  }

  /**
   * Apaga as credenciais. Se a Meta era a ativa, a empresa volta ao número
   * pareado por QR code — `meta` sem credencial não é um estado válido.
   */
  async remove(clinicId: string): Promise<MetaConnection> {
    await this.prisma.clinicSettings.updateMany({
      where: { clinicId },
      data: {
        whatsappProvider: 'evolution',
        metaPhoneNumberId: null,
        metaWabaId: null,
        metaAccessTokenEnc: null,
        metaDisplayPhone: null,
        metaVerifiedName: null,
      },
    });
    return this.getStatus(clinicId);
  }

  private serverReady(): boolean {
    return Boolean(
      this.config.get('META_APP_SECRET', { infer: true }) &&
      this.config.get('META_WEBHOOK_VERIFY_TOKEN', { infer: true }) &&
      this.config.get('INTEGRATION_ENCRYPTION_KEY', { infer: true }) &&
      this.config.get('API_PUBLIC_URL', { infer: true }),
    );
  }

  private webhookUrl(): string | null {
    const base = this.config.get('API_PUBLIC_URL', { infer: true });
    return base ? `${base.replace(/\/+$/, '')}/whatsapp/meta/webhook` : null;
  }
}
