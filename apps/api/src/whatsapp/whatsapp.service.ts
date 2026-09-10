import { Injectable, Logger } from '@nestjs/common';
import { AiUnavailableError } from '../ai/generate-reply';
import { OptOutService } from '../automations/opt-out.service';
import { OutboundService } from '../automations/outbound.service';
import { ChatService } from '../chat/chat.service';
import { runWithContext, setContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from './evolution.service';
import {
  type EvolutionWebhookPayload,
  type ParsedInbound,
  parseInboundMessage,
} from './webhook.types';

/** Claims antigos não têm valor operacional e são removidos diariamente. */
const INBOUND_RETENTION_MS = 7 * 24 * 60 * 60_000;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly evolution: EvolutionService,
    private readonly optOut: OptOutService,
    private readonly outbound: OutboundService,
  ) {}

  /**
   * Processa um evento do webhook. **Nunca lança** (o controller já respondeu
   * 200 e isto roda em background): falhas são logadas e seguem.
   *
   * O turno roda dentro de um escopo de correlação próprio: o webhook nasce fora
   * de um request HTTP, então não herda o `requestId` do middleware. O
   * `messageId` da Evolution é o id natural — se ela reentregar a mensagem, as
   * duas passagens aparecem no log sob o mesmo id, que é como se identifica uma
   * reentrega sem adivinhar (P0.3).
   */
  async handleWebhook(payload: EvolutionWebhookPayload): Promise<void> {
    const inbound = parseInboundMessage(payload);
    if (!inbound) return;
    await runWithContext(
      { requestId: `wa:${inbound.messageId}`, channel: 'whatsapp' },
      () => this.processInbound(inbound),
    );
  }

  /** O turno em si, já dentro do escopo de correlação. */
  private async processInbound(inbound: ParsedInbound): Promise<void> {
    const startedAt = Date.now();
    try {
      // A empresa precisa ser conhecida antes do claim porque a unicidade é
      // `(clinicId, externalId)`: duas empresas não compartilham namespace.
      const clinicId = await this.resolveClinicId(inbound.instance);
      if (!clinicId) {
        this.logger.warn(
          `Instância "${inbound.instance}" sem empresa mapeada — ignorando.`,
        );
        return;
      }
      setContext({ clinicId });

      if (!(await this.claimInbound(clinicId, inbound.messageId))) {
        this.logger.log({
          event: 'whatsapp.inbound',
          outcome: 'ok',
          reason: 'reentrega_ignorada',
        });
        return;
      }
      this.logger.log({
        event: 'whatsapp.inbound',
        outcome: 'ok',
        tipo: inbound.text ? 'texto' : 'audio',
      });

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

      const { conversationId, reply, attachments } =
        await this.chat.processInboundMessage({
          clinicId,
          channel: 'whatsapp',
          contactPhone: inbound.phone,
          contactName: inbound.pushName,
          ...turn,
        });

      if (reply || attachments.length > 0) {
        const target = await this.replyTarget(inbound);
        if (reply) {
          try {
            await this.evolution.sendText(inbound.instance, target, reply);
          } catch (err) {
            await this.queueFailedReply({
              clinicId,
              conversationId,
              messageId: inbound.messageId,
              phone: inbound.phone,
              body: reply,
              err,
            });
            // Sem o texto, os anexos de saudação/oferta perderiam contexto.
            // A fila recupera o texto; mídia continua best-effort e não sai só.
            return;
          }
          // Fecha o fluxo `whatsapp.inbound → ai.reply → whatsapp.outbound`: com
          // esta linha dá para afirmar que a resposta saiu, e sem ela dá para
          // afirmar que não saiu — que é a pergunta que o suporte faz.
          this.logger.log({
            event: 'whatsapp.outbound',
            outcome: 'ok',
            durationMs: Date.now() - startedAt,
            anexos: attachments.length,
          });
        }
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
      this.logger.error({
        event: 'whatsapp.inbound',
        outcome: 'fail',
        durationMs: Date.now() - startedAt,
        reason: err instanceof Error ? err.name : 'desconhecido',
      });
      await this.handleError(err, inbound);
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

  /**
   * Claim insert-first persistente. `P2002` é reentrega; qualquer outra falha
   * é fail-open, porque responder duas vezes é recuperável e nunca responder
   * não é. O erro fica no log para corrigir a dedupe sem parar o atendimento.
   */
  private async claimInbound(
    clinicId: string,
    externalId: string,
  ): Promise<boolean> {
    try {
      await this.prisma.inboundMessage.create({
        data: { clinicId, externalId },
      });
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      this.logger.error({
        event: 'whatsapp.inbound.dedupe',
        outcome: 'fail_open',
        reason: err instanceof Error ? err.name : 'desconhecido',
      });
      return true;
    }
  }

  /** Limpeza diária dos claims já fora da janela de reentrega útil. */
  async cleanupInboundMessages(now = new Date()): Promise<number> {
    const removed = await this.prisma.inboundMessage.deleteMany({
      where: {
        processedAt: {
          lt: new Date(now.getTime() - INBOUND_RETENTION_MS),
        },
      },
    });
    return removed.count;
  }

  /** Falha do envio direto → fila idempotente, sem respeitar janela ativa. */
  private async queueFailedReply(input: {
    clinicId: string;
    conversationId: string;
    messageId: string;
    phone: string;
    body: string;
    err: unknown;
  }): Promise<void> {
    const detail =
      input.err instanceof Error ? input.err.message : String(input.err);
    const result = await this.outbound.enqueue({
      clinicId: input.clinicId,
      kind: 'resposta_ia',
      dedupeKey: `resposta:${input.messageId}`,
      scheduledFor: new Date(),
      body: input.body,
      phone: input.phone,
      conversationId: input.conversationId,
      respectSendWindow: false,
    });
    this.logger.error({
      event: 'whatsapp.outbound',
      outcome: 'queued',
      reason: input.err instanceof Error ? input.err.name : 'desconhecido',
      queueResult: result,
      detail,
    });
  }

  /** Trata erros do processamento: IA indisponível → fallback amigável. */
  private async handleError(
    err: unknown,
    inbound: ParsedInbound,
  ): Promise<void> {
    const detail = err instanceof Error ? err.message : String(err);
    this.logger.error(
      `Falha ao processar webhook do WhatsApp: ${detail}`,
      err instanceof Error ? err.stack : undefined,
    );

    if (err instanceof AiUnavailableError) {
      await this.safeSend(
        inbound.instance,
        await this.replyTarget(inbound),
        AI_FALLBACK,
      );
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

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  );
}
