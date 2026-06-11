/**
 * Deep-link de contato wa.me a partir do telefone capturado do lead — abre a
 * conversa no WhatsApp do dono. NÃO é a integração WhatsApp (Evolution,
 * pós-MVP): nenhuma mensagem é enviada pelo sistema.
 */
export function whatsappUrl(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  // 10–11 dígitos = DDD + número (BR, sem DDI) → prefixa 55.
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}`;
}
