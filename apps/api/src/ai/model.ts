import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import type { LanguageModel } from 'ai';
import { createMockModel } from './mock-model';

/**
 * Provider de IA isolado (BE-1.5). Factory `getModel()` que lê `LLM_PROVIDER`
 * e devolve o modelo do Vercel AI SDK — trocável por env, sem tocar nas tools.
 *
 * MVP: Gemini (free tier) como padrão, Groq como alternativa gratuita.
 * Claude/OpenAI entram na produção adicionando os providers aqui.
 * `mock` (QA-4.2) é determinístico/offline — só para E2E e testes, nunca produção.
 */
export type LlmProvider = 'google' | 'groq' | 'mock';

const SUPPORTED: readonly LlmProvider[] = ['google', 'groq', 'mock'];

/** Modelos padrão por provider (sobrescrevíveis por env). */
const DEFAULT_MODEL: Record<LlmProvider, string> = {
  // gemini-2.5-flash: free tier ativo e rápido (o 2.0-flash veio com quota 0
  // em alguns projetos). Sobrescreva com GOOGLE_MODEL se quiser outro.
  google: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
  mock: 'dentaltrack-mock',
};

function asProvider(value: string | undefined): LlmProvider | undefined {
  return value && (SUPPORTED as readonly string[]).includes(value)
    ? (value as LlmProvider)
    : undefined;
}

/** Provider primário (env `LLM_PROVIDER`, default google). */
export function getProvider(): LlmProvider {
  return asProvider(process.env.LLM_PROVIDER) ?? 'google';
}

/** Provider de fallback (env `LLM_FALLBACK_PROVIDER`), se configurado e válido. */
export function getFallbackProvider(): LlmProvider | undefined {
  return asProvider(process.env.LLM_FALLBACK_PROVIDER);
}

/** Resolve o modelo do AI SDK para o provider informado (ou o primário). */
export function getModel(provider: LlmProvider = getProvider()): LanguageModel {
  switch (provider) {
    case 'google':
      // Lê GOOGLE_GENERATIVE_AI_API_KEY do ambiente automaticamente.
      return google(process.env.GOOGLE_MODEL ?? DEFAULT_MODEL.google);
    case 'groq':
      // Lê GROQ_API_KEY do ambiente automaticamente.
      return groq(process.env.GROQ_MODEL ?? DEFAULT_MODEL.groq);
    case 'mock':
      // Determinístico/offline (QA-4.2) — usado pelo Playwright E2E.
      return createMockModel();
    default:
      throw new Error(
        `LLM_PROVIDER "${String(provider)}" não suportado no MVP (use "google" ou "groq").`,
      );
  }
}
