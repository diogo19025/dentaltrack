import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  acceptedFormatsLabel,
  LOGO_MIME_TYPES,
  MEDIA_EXTENSION_BY_MIME,
  MEDIA_MAX_BYTES,
  MEDIA_MIME_TO_TYPE,
  type MediaPurpose,
  type MediaType,
  type MediaUploadResult,
} from '@dentaltrack/shared';
import type { Env } from '../config/env.validation';

/** Bucket padrão. Público de propósito — ver `ensureBucket`. */
const DEFAULT_BUCKET = 'media';

/** Quanto esperamos pelo storage antes de desistir de uma chamada. */
const TIMEOUT_MS = 20_000;

interface UploadInput {
  clinicId: string;
  purpose: MediaPurpose;
  originalName?: string;
  mimetype?: string;
  buffer: Buffer;
}

/**
 * Armazenamento de arquivos sobre o **Supabase Storage**.
 *
 * Por que o Supabase e não um serviço novo: o projeto já depende dele para
 * banco e autenticação, as credenciais já estão no ambiente, e o arquivo
 * precisa sair por uma **URL pública** — é assim que a Evolution envia mídia no
 * WhatsApp (`EvolutionService.sendMedia` recebe URL, não bytes). Guardar o
 * arquivo num lugar sem URL pública resolveria a tela e quebraria o canal.
 *
 * Sem dependência nova: a API REST do Storage é chamada por `fetch`, o mesmo
 * movimento do `GoogleCalendarClient`, que assina JWT com `node:crypto` em vez
 * de trazer o SDK do Google.
 *
 * **Escrita não repete.** Vale aqui a regra escrita no `common/http-retry.ts`:
 * repetir um upload cuja resposta se perdeu cria um objeto órfão por tentativa.
 * O nome do objeto é aleatório justamente porque não existe chave de
 * idempotência natural — o custo de falhar é o dono clicar de novo.
 */
@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);
  /** Evita um HTTP a mais por upload depois que o bucket já foi confirmado. */
  private bucketReady = false;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Dá para guardar arquivo neste ambiente?
   *
   * `SUPABASE_SERVICE_ROLE_KEY` é opcional no schema de env — a API sobe sem
   * ela. Quem depende dela precisa perguntar antes, e a resposta precisa virar
   * mensagem para o operador, não stack trace para o dono da empresa.
   */
  isConfigured(): boolean {
    return Boolean(this.supabaseUrl() && this.serviceKey());
  }

  /**
   * Valida e guarda o arquivo; devolve a URL pública e o tipo inferido.
   *
   * A validação é por **MIME e tamanho**, nunca pela extensão do nome que o
   * navegador mandou: o nome vem do cliente e não prova nada sobre o conteúdo.
   */
  async upload(input: UploadInput): Promise<MediaUploadResult> {
    const mimetype = (input.mimetype ?? '').toLowerCase().split(';')[0].trim();
    const type = this.validateMime(mimetype, input.purpose);

    if (input.buffer.byteLength === 0) {
      throw new BadRequestException('O arquivo enviado está vazio.');
    }
    const max = MEDIA_MAX_BYTES[input.purpose];
    if (input.buffer.byteLength > max) {
      throw new PayloadTooLargeException(
        `Arquivo muito grande (${formatBytes(input.buffer.byteLength)}). Aceitamos ${acceptedFormatsLabel(input.purpose)}.`,
      );
    }

    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'O envio de arquivos não está configurado neste servidor. Defina SUPABASE_SERVICE_ROLE_KEY na API (ver docs/operacao.md) — ou informe a URL da imagem no campo ao lado.',
      );
    }

    await this.ensureBucket();

    // Caminho escopado por empresa: além de organizar, é o que permite apagar
    // tudo de um tenant sem varrer o bucket inteiro.
    const extension = MEDIA_EXTENSION_BY_MIME[mimetype] ?? 'bin';
    const objectPath = `${input.clinicId}/${input.purpose}/${randomUUID()}.${extension}`;

    const response = await this.request(
      `/storage/v1/object/${this.bucket()}/${objectPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': mimetype,
          // Nome aleatório não colide; o upsert existe só para um retry manual
          // não esbarrar em 409 caso o nome se repita por acaso.
          'x-upsert': 'true',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        body: new Uint8Array(input.buffer),
      },
    );

    if (!response.ok) {
      const detail = await safeText(response);
      this.logger.error({
        event: 'media.upload',
        outcome: 'fail',
        status: response.status,
        purpose: input.purpose,
        detail,
      });
      throw new ServiceUnavailableException(
        `Não foi possível guardar o arquivo agora (o armazenamento respondeu ${response.status}). Tente de novo em instantes.`,
      );
    }

    const url = `${this.supabaseUrl()}/storage/v1/object/public/${this.bucket()}/${objectPath}`;
    this.logger.log({
      event: 'media.upload',
      outcome: 'ok',
      purpose: input.purpose,
      type,
      bytes: input.buffer.byteLength,
    });

    return {
      url,
      type,
      fileName: input.originalName ?? objectPath,
      bytes: input.buffer.byteLength,
    };
  }

  /** MIME aceito para esta finalidade? Devolve o tipo de domínio. */
  private validateMime(mimetype: string, purpose: MediaPurpose): MediaType {
    if (purpose === 'logo') {
      const allowed = LOGO_MIME_TYPES as readonly string[];
      if (!allowed.includes(mimetype)) {
        throw new BadRequestException(
          `Formato não aceito para a logo. Use ${acceptedFormatsLabel('logo')}.`,
        );
      }
      return 'image';
    }

    const type = MEDIA_MIME_TO_TYPE[mimetype];
    if (!type) {
      throw new BadRequestException(
        `Formato não aceito. Use ${acceptedFormatsLabel('oferta')}.`,
      );
    }
    return type;
  }

  /**
   * Cria o bucket na primeira vez, público.
   *
   * **Público é requisito, não descuido:** a Evolution busca a mídia pela URL,
   * do servidor dela, sem as nossas credenciais. URL assinada com validade
   * expiraria dentro de uma configuração que fica salva por meses, e a oferta
   * pararia de sair sem ninguém mexer em nada.
   *
   * Já existir é sucesso, então chamar de novo não custa — mesmo desenho
   * idempotente do resto do projeto.
   */
  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;

    const response = await this.request('/storage/v1/bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: this.bucket(),
        name: this.bucket(),
        public: true,
      }),
    });

    if (response.ok || response.status === 409) {
      this.bucketReady = true;
      return;
    }

    const detail = await safeText(response);
    // Dependendo da versão, "já existe" chega como 400 com a mensagem no corpo.
    if (/exist|duplicate/i.test(detail)) {
      this.bucketReady = true;
      return;
    }

    this.logger.error({
      event: 'media.bucket',
      outcome: 'fail',
      status: response.status,
      detail,
    });
    throw new ServiceUnavailableException(
      `Não foi possível preparar o armazenamento (${response.status}). Verifique a SUPABASE_SERVICE_ROLE_KEY da API.`,
    );
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const key = this.serviceKey();
    try {
      return await fetch(`${this.supabaseUrl()}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'desconhecido';
      this.logger.error({ event: 'media.upload', outcome: 'fail', reason });
      throw new ServiceUnavailableException(
        reason === 'TimeoutError'
          ? 'O armazenamento demorou demais para responder. Tente de novo.'
          : 'Não foi possível falar com o armazenamento agora.',
      );
    }
  }

  private supabaseUrl(): string {
    const url = this.config.get('SUPABASE_URL', { infer: true }) ?? '';
    return url.replace(/\/+$/, '');
  }

  private serviceKey(): string {
    return this.config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true }) ?? '';
  }

  private bucket(): string {
    return (
      this.config.get('SUPABASE_STORAGE_BUCKET', { infer: true }) ??
      DEFAULT_BUCKET
    );
  }
}

/** Corpo de erro do storage, sem deixar o parse derrubar o tratamento. */
async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
