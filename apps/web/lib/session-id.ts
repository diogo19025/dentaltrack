/**
 * Identidade do **login** atual, lida do access token do Supabase.
 *
 * O claim `session_id` é o mesmo em todos os refreshes de um login e muda a
 * cada login novo — é o que permite "mostrar uma vez por login": um aviso
 * dispensado fica guardado junto deste id e volta quando o id mudar.
 *
 * Só leitura do payload, sem verificar assinatura: o token já foi validado
 * pelo `getUser()` do servidor antes de chegar aqui, e o valor serve apenas
 * como chave de preferência no navegador.
 */
export function sessionIdFromToken(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json) as { session_id?: unknown };
    return typeof claims.session_id === "string" && claims.session_id ? claims.session_id : null;
  } catch {
    return null;
  }
}
