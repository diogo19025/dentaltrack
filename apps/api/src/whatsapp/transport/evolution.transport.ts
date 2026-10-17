import { Logger } from '@nestjs/common';
import type { MediaAttachment } from '@dentaltrack/shared';
import type { EvolutionService } from '../evolution.service';
import type {
  InboundAudioRef,
  WhatsappRecipient,
  WhatsappTransport,
} from './whatsapp-transport';

/**
 * Adapter da Evolution (Baileys) atrás da porta `WhatsappTransport`. Só
 * delega ao `EvolutionService`, amarrado à instância da empresa — o endereço
 * em LID é detalhe do Baileys e mora aqui, não em quem envia.
 */
export class EvolutionTransport implements WhatsappTransport {
  private readonly logger = new Logger(EvolutionTransport.name);

  constructor(
    private readonly evolution: EvolutionService,
    readonly instance: string,
  ) {}

  /**
   * Contato migrado para **LID** só recebe no JID `@lid` — enviar para o
   * telefone fica preso em PENDING. Na resposta, só se busca o LID quando o
   * webhook sinalizou `addressingMode: 'lid'`; no envio proativo não há esse
   * sinal, então sempre se tenta. Sem LID, o telefone, como sempre foi. Ver
   * `EvolutionService.resolveLidJid`.
   */
  async resolveAddress(recipient: WhatsappRecipient): Promise<string> {
    const { phone, inReplyTo } = recipient;
    if (!inReplyTo) {
      return (
        (await this.evolution.resolveLidJid(
          this.instance,
          `${phone}@s.whatsapp.net`,
        )) ?? phone
      );
    }
    if (inReplyTo.addressingMode !== 'lid') return phone;

    const lid = await this.evolution.resolveLidJid(
      this.instance,
      inReplyTo.remoteJid,
      inReplyTo.messageId,
    );
    if (lid) return lid;
    this.logger.warn(
      `LID não resolvido para ${phone} — enviando ao telefone (pode não entregar).`,
    );
    return phone;
  }

  sendText(address: string, text: string): Promise<void> {
    return this.evolution.sendText(this.instance, address, text);
  }

  sendMedia(address: string, attachment: MediaAttachment): Promise<void> {
    return this.evolution.sendMedia(this.instance, address, attachment);
  }

  /** Usa o base64 do webhook ou o busca pela `key` original da mensagem. */
  async fetchInboundAudio(audio: InboundAudioRef): Promise<string | undefined> {
    return (
      audio.base64 ??
      (await this.evolution.getMediaBase64(this.instance, audio.ref))
    );
  }
}
