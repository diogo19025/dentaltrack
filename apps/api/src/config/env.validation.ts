import { z } from "zod";

/** Schema das variáveis de ambiente da API (validado no boot). */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  // HS256 (projetos legados). Ausente → o guard valida via JWKS (assimétrico).
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Origens permitidas no CORS (separadas por vírgula).
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // ─── IA (BE-1.5 / BE-1.8) ───
  // Provider do LLM. MVP gratuito: google (Gemini) | groq.
  LLM_PROVIDER: z.enum(["google", "groq"]).default("google"),
  // Fallback opcional se o provider primário falhar (hardening).
  LLM_FALLBACK_PROVIDER: z.enum(["google", "groq"]).optional(),
  // Chave do Gemini (free tier) — provider padrão do MVP.
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GOOGLE_MODEL: z.string().optional(),
  // Alternativa gratuita (Groq).
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  // Hardening do provider (timeout/retry).
  AI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Função `validate` do @nestjs/config. */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `Variáveis de ambiente inválidas:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  return parsed.data;
}
