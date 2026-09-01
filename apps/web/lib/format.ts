/** Formatadores de data/número usados nas telas de dashboard e leads. */

/** Tempo relativo curto, pt-BR ("agora", "há 12 min", "há 2 h", "ontem", …). */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

/** Data de captura do lead ("Hoje, 14:22", "Ontem, 19:40", "3 dias atrás", …). */
export function formatCaptured(iso: string): string {
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  const hhmm = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (dayDiff <= 0) return `Hoje, ${hhmm}`;
  if (dayDiff === 1) return `Ontem, ${hhmm}`;
  if (dayDiff < 7) return `${dayDiff} dias atrás`;
  return date.toLocaleDateString("pt-BR");
}

/** Rótulo amigável da origem do lead/conversa ("Web", "WhatsApp", …). */
export function sourceLabel(source: string): string {
  if (source === "web") return "Web";
  if (source === "whatsapp") return "WhatsApp";
  if (source === "manual") return "Manual";
  if (source === "import") return "Importado";
  if (source === "clinicorp") return "Clinicorp";
  if (source === "google") return "Google Agenda";
  return source;
}

/** Iniciais (até 2) de um nome, com fallback quando vazio. */
export function initials(name: string | null | undefined, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const out = parts.map((w) => w[0]).join("").toUpperCase();
  return out || fallback;
}
