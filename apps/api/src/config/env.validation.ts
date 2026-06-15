import { z } from 'zod';

/** Schema das variáveis de ambiente da API (validado no boot). */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  // HS256 (projetos legados). Ausente → o guard valida via JWKS (assimétrico).
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Origens permitidas no CORS (separadas por vírgula).
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // ─── IA (BE-1.5 / BE-1.8) ───
  // Provider do LLM. Padrão: openai (GPT, API paga); google (Gemini) e groq
  // seguem como alternativas. "mock" é determinístico/offline (QA-4.2) — só para E2E/testes.
  LLM_PROVIDER: z.enum(['openai', 'google', 'groq', 'mock']).default('openai'),
  // Fallback opcional se o provider primário falhar (hardening).
  LLM_FALLBACK_PROVIDER: z.enum(['openai', 'google', 'groq']).optional(),
  // Chave da OpenAI (API paga) — provider padrão.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  // Modelo Whisper do speech-to-text quando LLM_PROVIDER=openai.
  OPENAI_TRANSCRIBE_MODEL: z.string().optional(),
  // Chave do Gemini (free tier) — fallback/alternativa.
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GOOGLE_MODEL: z.string().optional(),
  // Alternativa gratuita (Groq).
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  // Modelo Whisper do speech-to-text quando LLM_PROVIDER=groq.
  GROQ_TRANSCRIBE_MODEL: z.string().optional(),
  // Hardening do provider (timeout/retry).
  AI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).optional(),

  // ─── F3 ───
  // Confiança mínima para gravar uma tag no auto-tagging (BE-3.1).
  AI_TAG_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).optional(),
  // Horas de inatividade até marcar a conversa como abandonada (cron BE-3.4).
  ABANDON_AFTER_HOURS: z.coerce.number().int().positive().optional(),

  // ─── WhatsApp (WA) ───
  // Janela (horas) em que uma conversa de WhatsApp ainda `em_andamento` é reusada
  // para o mesmo telefone; fora dela abre-se uma nova conversa (WA-2). Default 24.
  WHATSAPP_SESSION_HOURS: z.coerce.number().int().positive().optional(),
  // Endereço da Evolution API (ex.: http://localhost:8080). Sem ela, o WhatsApp
  // fica inativo (o webhook ignora mensagens sem clínica mapeada). (WA-3)
  EVOLUTION_API_URL: z.string().url().optional(),
  // Chave global da Evolution (header `apikey` nas chamadas de saída). (WA-3)
  EVOLUTION_API_KEY: z.string().optional(),
  // Segredo opcional para autenticar o webhook (header `x-evolution-token`). (WA-4)
  EVOLUTION_WEBHOOK_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Função `validate` do @nestjs/config. */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `Variáveis de ambiente inválidas:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  return parsed.data;
}
