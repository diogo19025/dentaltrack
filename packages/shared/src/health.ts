import { z } from "zod";

/**
 * Contrato do endpoint GET /health da API (ver docs/produto.md).
 *
 * O endpoint é **público e global**, então só reporta o que vale para a
 * instalação inteira — nada por empresa, que vazaria estado de cliente para
 * quem não está autenticado. O estado da conexão de cada empresa vive na tela
 * de configurações, não aqui.
 */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  db: z.enum(["up", "down"]),
  uptime: z.number(),
  timestamp: z.string(),
  /** Commit publicado — a primeira pergunta quando um deploy sai errado. */
  version: z.string().nullable(),
  /** Transporte do WhatsApp configurado no ambiente (não é o estado da sessão). */
  whatsapp: z.enum(["configurado", "nao_configurado"]),
  /** Captura de exceptions ativa (P0.3). */
  monitoramento: z.enum(["ativo", "desligado"]),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
