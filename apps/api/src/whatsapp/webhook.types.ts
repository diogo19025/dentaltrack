/**
 * Tipos e parser do webhook da Evolution API (WA-3). A Evolution posta eventos
 * (ex.: `messages.upsert`) num único endpoint; aqui normalizamos o payload para
 * o que o motor precisa: instância (→ clínica), telefone (identidade), texto ou
 * áudio. Tudo defensivo — payloads variam entre versões da Evolution.
 */

/** `key` da mensagem do Baileys (remetente, direção, id). */
interface EvolutionMessageKey {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
  /**
   * Telefone "real" (`@s.whatsapp.net`) quando o contato foi migrado p/ **LID**.
   * Com LID, a Evolution reescreve `remoteJid` p/ o telefone antes de postar o
   * webhook (perdemos o `@lid`), mas mantém `addressingMode: 'lid'` — o sinal de
   * que a resposta precisa ir p/ o JID `@lid`, não p/ o telefone (senão não
   * entrega). Ver `EvolutionService.resolveLidJid`.
   */
  remoteJidAlt?: string;
  addressingMode?: string;
}

/** Conteúdo da mensagem (um dos campos preenchido conforme o tipo). */
interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  audioMessage?: { mimetype?: string };
  /** base64 da mídia quando o webhook está configurado com base64 (WEBHOOK_BASE64). */
  base64?: string;
}

interface EvolutionMessageData {
  key?: EvolutionMessageKey;
  pushName?: string;
  message?: EvolutionMessageContent;
  messageType?: string;
  base64?: string;
}

/** Envelope do webhook da Evolution. */
export interface EvolutionWebhookPayload {
  event?: string;
  instance?: string;
  data?: EvolutionMessageData;
  apikey?: string;
}

/** Mensagem de entrada já normalizada (texto OU áudio). */
export interface ParsedInbound {
  instance: string;
  messageId: string;
  /** Só dígitos (parte antes do `@` do JID) — identidade do contato. */
  phone: string;
  remoteJid: string;
  /**
   * `'lid'` quando o contato usa **LID addressing**. Nesse caso a resposta deve
   * ser endereçada ao JID `@lid` (resolvido on-demand), não ao telefone.
   */
  addressingMode?: string;
  pushName?: string;
  text?: string;
  /** Presente quando a mensagem é um áudio (PTT). base64 pode faltar (buscar depois). */
  audio?: { base64?: string; mimeType: string; key: EvolutionMessageKey };
}

/** Normaliza o nome do evento ("messages.upsert" | "MESSAGES_UPSERT" → "messages.upsert"). */
function normalizeEvent(event: string | undefined): string {
  return (event ?? '').toLowerCase().replace(/_/g, '.');
}

/**
 * Extrai uma mensagem de entrada acionável do payload, ou `null` quando deve ser
 * ignorada: evento que não é `messages.upsert`, mensagem própria (`fromMe`),
 * grupo/status, ou tipo não suportado (imagem/documento por ora).
 */
export function parseInboundMessage(
  payload: EvolutionWebhookPayload,
): ParsedInbound | null {
  if (normalizeEvent(payload.event) !== 'messages.upsert') return null;

  const data = payload.data;
  const key = data?.key;
  const instance = payload.instance?.trim();
  const remoteJid = key?.remoteJid;
  const messageId = key?.id;

  if (!instance || !remoteJid || !messageId) return null;
  if (key?.fromMe) return null; // eco da própria mensagem enviada
  // Só conversas individuais — ignora grupos (@g.us) e status (status@broadcast).
  if (!remoteJid.endsWith('@s.whatsapp.net')) return null;

  const phone = remoteJid.split('@')[0];
  const base: Omit<ParsedInbound, 'text' | 'audio'> = {
    instance,
    messageId,
    phone,
    remoteJid,
    addressingMode: key?.addressingMode,
    pushName: data?.pushName,
  };

  const msg = data?.message;
  const text = msg?.conversation ?? msg?.extendedTextMessage?.text;
  if (text && text.trim()) {
    return { ...base, text: text.trim() };
  }

  const audioMime = msg?.audioMessage?.mimetype;
  if (audioMime || data?.messageType === 'audioMessage') {
    return {
      ...base,
      audio: {
        base64: msg?.base64 ?? data?.base64,
        // PTT do WhatsApp é ogg/opus; normaliza removendo parâmetros (";codecs=opus").
        mimeType: (audioMime ?? 'audio/ogg').split(';')[0].trim(),
        key: key,
      },
    };
  }

  return null; // tipo não suportado (imagem, documento, etc.)
}
