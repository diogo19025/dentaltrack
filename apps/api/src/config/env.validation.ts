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

  // ─── Observabilidade (P0.3) ───
  // Formato do log. Sem ela, `production` sai em JSON e o resto em texto
  // colorido. Existe para dar caminho de volta se o JSON atrapalhar uma
  // investigação ao vivo.
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  // DSN do Sentry. **Ausente = monitoramento desligado**, sem erro: é o que
  // mantém desenvolvimento e testes sem rede e sem ruído.
  SENTRY_DSN: z.string().optional(),
  // Amostragem de tracing. Default 0 — o valor aqui é o erro, não o APM.
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  // Commit publicado, exposto em GET /health e usado como release no Sentry.
  // A primeira pergunta quando um deploy sai errado é "qual versão está no ar?".
  APP_VERSION: z.string().optional(),

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
  // Confiança mínima para o detector do funil mover um card de estágio (F7).
  AI_STAGE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).optional(),

  // ─── WhatsApp (WA) ───
  // URL pública desta API, usada como destino do webhook ao criar a instância
  // da empresa (F10). No dev com a Evolution em Docker, é
  // http://host.docker.internal:3001; em produção, a URL da API na nuvem.
  // Sem ela, o pareamento por QR na tela fica indisponível (o webhook não teria
  // para onde apontar) e o runbook manual segue valendo.
  API_PUBLIC_URL: z.string().url().optional(),
  // Janela (horas) em que uma conversa de WhatsApp ainda `em_andamento` é reusada
  // para o mesmo telefone; fora dela abre-se uma nova conversa (WA-2). Default 24.
  WHATSAPP_SESSION_HOURS: z.coerce.number().int().positive().optional(),
  // Endereço da Evolution API (ex.: http://localhost:8080). Sem ela, o WhatsApp
  // fica inativo (o webhook ignora mensagens sem empresa mapeada). (WA-3)
  EVOLUTION_API_URL: z.string().url().optional(),
  // Chave global da Evolution (header `apikey` nas chamadas de saída). (WA-3)
  EVOLUTION_API_KEY: z.string().optional(),
  // Tempo máximo de uma chamada à Evolution. Leituras transitórias repetem;
  // escritas nunca são repetidas pelo transporte (P0.4).
  EVOLUTION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  // Segredo opcional para autenticar o webhook (header `x-evolution-token`). (WA-4)
  EVOLUTION_WEBHOOK_TOKEN: z.string().optional(),

  // --- F9: agenda, integracao e automacoes ---
  // Chave AES-256 (32 bytes: 64 hex ou 44 base64) que cifra as credenciais da
  // integracao no banco. Sem ela a empresa nao consegue salvar credencial —
  // falhar fechado e melhor do que guardar segredo em texto puro.
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
  // Intervalo (minutos) da sincronizacao da agenda com o sistema de gestao.
  // A API observada nao expoe webhook, entao a deteccao de falta/atraso depende
  // deste polling. Default 10.
  AGENDA_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().optional(),
  // Janela (dias) para tras e para frente sincronizada a cada rodada.
  AGENDA_SYNC_PAST_DAYS: z.coerce.number().int().min(0).optional(),
  AGENDA_SYNC_FUTURE_DAYS: z.coerce.number().int().positive().optional(),
  // --- F12: Google Agenda (provedor alternativo ao Clinicorp) ---
  // Service account do Google Cloud com a Calendar API habilitada. A empresa
  // compartilha a agenda dela com este e-mail; a chave privada (PEM, aceita
  // "\n" escapado ou base64) assina o JWT trocado por access token. Sem o par,
  // o provedor google fica indisponível (a tela avisa).
  GOOGLE_CALENDAR_SA_EMAIL: z.string().email().optional(),
  GOOGLE_CALENDAR_SA_KEY: z.string().optional(),

  // Pausa (ms) entre dois envios automaticos consecutivos — higiene anti-ban.
  OUTBOUND_THROTTLE_MS: z.coerce.number().int().min(0).optional(),
  // Quantas mensagens a fila despacha por rodada do worker.
  OUTBOUND_BATCH_SIZE: z.coerce.number().int().positive().optional(),
  // Desliga globalmente o envio automatico (kill switch de operacao).
  AUTOMATIONS_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),

  // Expurgo periodico da fila de saida ja finalizada (P1.5). Nasce DESLIGADO:
  // apagar dado de cliente sem ele pedir e pior do que guardar demais, e o
  // default de `AUTOMATIONS_ENABLED` (ligado) seria a escolha errada aqui.
  RETENTION_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  // Janela de retencao em dias (default 365, piso de 30 no job).
  DATA_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
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
