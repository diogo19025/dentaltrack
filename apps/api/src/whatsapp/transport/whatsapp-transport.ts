import type { MediaAttachment } from '@dentaltrack/shared';

/**
 * Porta de transporte do canal WhatsApp — o mesmo desenho do `AgendaProvider`
 * (`clinicorp/agenda-provider.ts`). Quem envia (resposta do agente, fila de
 * automações, lembrete do CRM) fala com esta interface e não sabe se do outro
 * lado está a Evolution (Baileys) ou, no futuro, a Cloud API oficial da Meta.
 *
 * Cada instância já vem **amarrada à conta da empresa** (instância Evolution,
 * número na Meta): quem chama não repete a identidade da conta a cada envio.
 */
export interface WhatsappTransport {
  /**
   * Converte o destinatário no endereço que o provedor entrega. Separado do
   * envio porque a resposta do agente sai em várias mensagens (texto + mídia) e
   * o endereço é resolvido uma vez só.
   */
  resolveAddress(recipient: WhatsappRecipient): Promise<string>;
  sendText(address: string, text: string): Promise<void>;
  /** Mídia a partir de URL pública (F6/F13). Áudio sai como mensagem de voz. */
  sendMedia(address: string, attachment: MediaAttachment): Promise<void>;
  /** Base64 do áudio recebido, ou `undefined` se o provedor não o devolver. */
  fetchInboundAudio(audio: InboundAudioRef): Promise<string | undefined>;
}

/** Para quem vai a mensagem. */
export interface WhatsappRecipient {
  /** Só dígitos, com DDI. */
  phone: string;
  /**
   * A mensagem recebida que está sendo respondida, quando há uma. Ausente no
   * envio proativo (automação, lembrete). Alguns provedores precisam dela para
   * endereçar certo — na Evolution, contatos em LID.
   */
  inReplyTo?: {
    remoteJid: string;
    messageId: string;
    addressingMode?: string;
  };
}

/** Referência ao áudio de uma mensagem recebida. */
export interface InboundAudioRef {
  /** Já veio no webhook — não precisa buscar. */
  base64?: string;
  /** Identificador do provedor para buscar a mídia depois. */
  ref: unknown;
}
