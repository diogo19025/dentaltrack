import { MAX_INBOUND_TEXT_CHARS, type ParsedInbound } from './webhook.types';

/**
 * Parser do webhook da Cloud API da Meta. O envelope é `entry[].changes[]`,
 * cada `value` traz o número que recebeu (`metadata.phone_number_id`), os
 * contatos (nome) e as mensagens. Tudo defensivo: a Meta evolui o payload e
 * também posta *statuses* (entregue/lido) no mesmo endpoint, que ignoramos.
 */
interface MetaMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  audio?: { id?: string; mime_type?: string };
}

interface MetaValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MetaMessage[];
}

export interface MetaWebhookPayload {
  object?: string;
  entry?: { changes?: { field?: string; value?: MetaValue }[] }[];
}

/** Mensagens acionáveis do payload (texto e áudio); o resto é descartado. */
export function parseMetaInbound(payload: MetaWebhookPayload): ParsedInbound[] {
  if (payload.object !== 'whatsapp_business_account') return [];
  const out: ParsedInbound[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      for (const message of value?.messages ?? []) {
        if (!message.id || !message.from) continue;
        const base = {
          provider: 'meta' as const,
          instance: phoneNumberId,
          messageId: message.id,
          phone: message.from,
          remoteJid: message.from,
          pushName: value?.contacts?.find((c) => c.wa_id === message.from)
            ?.profile?.name,
        };

        const text = message.text?.body?.trim();
        if (message.type === 'text' && text) {
          out.push({ ...base, text: text.slice(0, MAX_INBOUND_TEXT_CHARS) });
        } else if (message.type === 'audio' && message.audio?.id) {
          out.push({
            ...base,
            audio: {
              mimeType: (message.audio.mime_type ?? 'audio/ogg')
                .split(';')[0]
                .trim(),
              ref: message.audio.id,
            },
          });
        }
      }
    }
  }
  return out;
}
