import { Injectable, Logger } from '@nestjs/common';
import { AiUnavailableError } from '../ai/generate-reply';
import { OptOutService } from '../automations/opt-out.service';
import { ChatService } from '../chat/chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from './evolution.service';
import {
  type EvolutionWebhookPayload,
  type ParsedInbound,
  parseInboundMessage,
} from './webhook.types';

/** Janela (ms) de deduplicação de `messageId` — a Evolution pode reentregar. */
const DEDUPE_TTL_MS = 5 * 60_000;

/** Resposta quando a IA está indisponível (mantém o cliente informado). */
const AI_FALLBACK =
  'Estou com uma instabilidade no momento e já volto a responder. Sua mensagem foi registrada. 🙏';

/** Confirmação de opt-out. O descadastro é persistido (F9 · OptOutService). */
const OPT_OUT_REPLY =
  'Tudo bem, não enviarei mais mensagens automáticas. Se precisar, é só chamar de novo.';

/**
 * Orquestra o canal WhatsApp (WA-3). Recebe o webhook já bruto da Evolution,
 * resolve a empresa pela instância, deduplica, roda o **mesmo** `ChatService`
 * (non-streaming) e devolve a resposta pela Evolution. Channel-agnostic: o motor
 * não muda — este serviço é só o adaptador de borda.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  /** messageId → timestamp de processamento (dedupe best-effort, em memória). */
  private readonly processed = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly evolution: EvolutionService,
    private readonly optOut: OptOutService,
  ) {}

  /**
   * Processa um evento do webhook. **Nunca lança** (o controller já respondeu
   * 200 e isto roda em background): falhas são logadas e seguem.
   */
  async handleWebhook(payload: EvolutionWebhookPayload): Promise<void> {
    try {
      const inbound = parseInboundMessage(payload);
      if (!inbound) return;
      if (this.isDuplicate(inbound.messageId)) return;

      const clinicId = await this.resolveClinicId(inbound.instance);
      if (!clinicId) {
        this.logger.warn(
          `Instância "${inbound.instance}" sem empresa mapeada — ignorando.`,
        );
        return;
      }

      // Descadastro: confirma, **persiste** e não roda o bot neste turno. A
      // persistência é o que faz o pedido sobreviver a um restart — o que era
      // opcional num bot receptivo e é obrigatório desde que passamos a enviar
      // mensagem sozinhos (F9).
      if (OptOutService.isOptOutMessage(inbound.text)) {
        await this.optOut.optOut(
          clinicId,
          inbound.phone,
          'palavra no WhatsApp',
        );
        await this.safeSend(
          inbound.instance,
          await this.replyTarget(inbound),
          OPT_OUT_REPLY,
        );
        return;
      }

      const turn = await this.buildTurn(inbound);
      if (!turn) return; // tipo não suportado / mídia indisponível

      const { reply, attachments } = await this.chat.processInboundMessage({
        clinicId,
        channel: 'whatsapp',
        contactPhone: inbound.phone,
        contactName: inbound.pushName,
        ...turn,
      });

      if (reply || attachments.length > 0) {
        const target = await this.replyTarget(inbound);
        if (reply)
          await this.evolution.sendText(inbound.instance, target, reply);
        // Mídia da saudação/oferta (F6): enviada após o texto, uma a uma.
        // Best-effort — a falha de um anexo não impede os demais nem a resposta.
        for (const media of attachments) {
          try {
            await this.evolution.sendMedia(inbound.instance, target, media);
          } catch (mediaErr) {
            const detail =
              mediaErr instanceof Error ? mediaErr.message : String(mediaErr);
            this.logger.error(
              `Falha ao enviar mídia (${media.type}) ao ${inbound.phone}: ${detail}`,
            );
          }
        }
      }
    } catch (err) {
      await this.handleError(err, payload);
    }
  }

  /**
   * Monta a entrada do turno (texto OU áudio). Para áudio, usa o base64 do
   * webhook ou o busca na Evolution (getBase64FromMediaMessage).
   */
  private async buildTurn(
    inbound: ParsedInbound,
  ): Promise<{ message?: string; audio?: string; audioType?: string } | null> {
    if (inbound.text) return { message: inbound.text };

    if (inbound.audio) {
      const base64 =
        inbound.audio.base64 ??
        (await this.evolution.getMediaBase64(
          inbound.instance,
          inbound.audio.key,
        ));
      if (!base64) {
        this.logger.warn(
          `Áudio sem base64 (instância ${inbound.instance}) — ignorando.`,
        );
        return null;
      }
      return { audio: base64, audioType: inbound.audio.mimeType };
    }

    return null;
  }

  /**
   * JID de destino da resposta. Contato migrado p/ **LID** (`addressingMode:
   * 'lid'`): resolve o JID `@lid` (enviar p/ o telefone não entrega — fica em
   * PENDING). Sem LID (ou se a resolução falhar): usa o telefone, como antes.
   */
  private async replyTarget(inbound: ParsedInbound): Promise<string> {
    if (inbound.addressingMode === 'lid') {
      const lid = await this.evolution.resolveLidJid(
        inbound.instance,
        inbound.remoteJid,
        inbound.messageId,
      );
      if (lid) return lid;
      this.logger.warn(
        `LID não resolvido para ${inbound.phone} — enviando ao telefone (pode não entregar).`,
      );
    }
    return inbound.phone;
  }

  /** Resolve a empresa dona da instância Evolution (WA-1). */
  private async resolveClinicId(instance: string): Promise<string | null> {
    const settings = await this.prisma.clinicSettings.findUnique({
      where: { whatsappInstance: instance },
      select: { clinicId: true },
    });
    return settings?.clinicId ?? null;
  }

  /** Dedupe best-effort por messageId, com limpeza preguiçosa da janela. */
  private isDuplicate(messageId: string): boolean {
    const now = Date.now();
    for (const [id, ts] of this.processed) {
      if (now - ts > DEDUPE_TTL_MS) this.processed.delete(id);
    }
    if (this.processed.has(messageId)) return true;
    this.processed.set(messageId, now);
    return false;
  }

  /** Trata erros do processamento: IA indisponível → fallback amigável. */
  private async handleError(
    err: unknown,
    payload: EvolutionWebhookPayload,
  ): Promise<void> {
    const detail = err instanceof Error ? err.message : String(err);
    this.logger.error(`Falha ao processar webhook do WhatsApp: ${detail}`);

    if (err instanceof AiUnavailableError) {
      const inbound = parseInboundMessage(payload);
      if (inbound) {
        await this.safeSend(
          inbound.instance,
          await this.replyTarget(inbound),
          AI_FALLBACK,
        );
      }
    }
  }

  /** Envia sem propagar erro (usado em caminhos de fallback). */
  private async safeSend(
    instance: string,
    phone: string,
    text: string,
  ): Promise<void> {
    try {
      await this.evolution.sendText(instance, phone, text);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enviar mensagem ao ${phone}: ${detail}`);
    }
  }
}
