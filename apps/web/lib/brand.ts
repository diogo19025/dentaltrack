/**
 * Marca da plataforma (whitelabel).
 *
 * Fonte de verdade para o nome/descrição do produto exibidos ANTES do login
 * (tela de login, `<title>` da aba) e como fallback quando ainda não há uma
 * empresa no contexto. Dentro do app (pós-login), a marca visível é a da
 * própria empresa (`clinicName`, multi-tenant) — ver `Sidebar`/`Topbar`.
 *
 * Para rebrandar um deploy, defina as variáveis `NEXT_PUBLIC_APP_*` (ou edite
 * os fallbacks abaixo). Nada aqui é específico de odontologia por padrão.
 */
export const brand = {
  /** Nome do produto (wordmark pré-login e fallback do shell). */
  name: (process.env.NEXT_PUBLIC_APP_NAME ?? "").trim() || "Nexo",
  /** Descrição curta (metadata da aba). */
  description:
    (process.env.NEXT_PUBLIC_APP_DESCRIPTION ?? "").trim() ||
    "CRM conversacional com IA para o seu atendimento.",
  /** Linha de apoio (rodapé do painel de marca no login). */
  tagline:
    (process.env.NEXT_PUBLIC_APP_TAGLINE ?? "").trim() ||
    "Plataforma de atendimento com IA",
} as const;

/**
 * Iniciais para o monograma da marca (1–2 letras).
 * Ex.: "Nexo" → "N"; "Empresa Sorriso Pleno" → "CP".
 */
export function brandInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
