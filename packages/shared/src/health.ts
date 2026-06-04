import { z } from "zod";

/** Contrato do endpoint GET /health da API (ver plan.md BE-0.1). */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  db: z.enum(["up", "down"]),
  uptime: z.number(),
  timestamp: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
